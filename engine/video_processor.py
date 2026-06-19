import os
import subprocess
import json
import re
import threading
import time

def get_ffmpeg_path():
    engine_dir = os.path.dirname(os.path.abspath(__file__))
    root_dir = os.path.dirname(engine_dir)
    
    candidates = [
        os.path.join(root_dir, "ffmpeg", "bin", "ffmpeg.exe"),
        os.path.join(root_dir, "ffmpeg", "ffmpeg.exe"),
        os.path.join(root_dir, "_includes", "ffmpeg.exe"),
        os.path.join(engine_dir, "ffmpeg.exe"),
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return "ffmpeg" # fallback to PATH

def get_ffprobe_path():
    engine_dir = os.path.dirname(os.path.abspath(__file__))
    root_dir = os.path.dirname(engine_dir)
    
    candidates = [
        os.path.join(root_dir, "ffmpeg", "bin", "ffprobe.exe"),
        os.path.join(root_dir, "ffmpeg", "ffprobe.exe"),
        os.path.join(root_dir, "_includes", "ffprobe.exe"),
        os.path.join(engine_dir, "ffprobe.exe"),
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return "ffprobe" # fallback to PATH

def get_media_info(filepath):
    """
    Inspects media file using ffprobe and returns metadata.
    """
    try:
        cmd = [
            get_ffprobe_path(), "-v", "quiet",
            "-print_format", "json",
            "-show_format", "-show_streams",
            filepath
        ]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        info = json.loads(result.stdout)
        
        has_video = False
        has_audio = False
        width = 0
        height = 0
        duration = 0.0
        
        for stream in info.get("streams", []):
            codec_type = stream.get("codec_type")
            if codec_type == "video":
                has_video = True
                width = int(stream.get("width", 0))
                height = int(stream.get("height", 0))
                if "duration" in stream:
                    try:
                        duration = max(duration, float(stream["duration"]))
                    except ValueError:
                        pass
            elif codec_type == "audio":
                has_audio = True
                if "duration" in stream:
                    try:
                        duration = max(duration, float(stream["duration"]))
                    except ValueError:
                        pass
                        
        if duration == 0.0 and "format" in info:
            fmt = info["format"]
            if "duration" in fmt:
                try:
                    duration = float(fmt["duration"])
                except ValueError:
                    pass
                    
        # Check if it is an image
        ext = os.path.splitext(filepath)[1].lower()
        is_image = ext in [".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tiff"]
        
        return {
            "has_video": has_video and not is_image,
            "has_audio": has_audio,
            "is_image": is_image,
            "width": width,
            "height": height,
            "duration": duration if not is_image else 0.0
        }
    except Exception as e:
        print(f"Error in ffprobe for {filepath}: {e}")
        ext = os.path.splitext(filepath)[1].lower()
        is_image = ext in [".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tiff"]
        is_audio = ext in [".mp3", ".wav", ".ogg", ".m4a", ".aac"]
        return {
            "has_video": not is_image and not is_audio,
            "has_audio": is_audio,
            "is_image": is_image,
            "width": 1280 if is_image else 0,
            "height": 720 if is_image else 0,
            "duration": 0.0
        }

def escape_ffmpeg_filter_text(text):
    """
    Escapes text content for FFmpeg drawtext filter.
    """
    text = text.replace('\\', '\\\\')
    text = text.replace("'", "'\\\\''")
    text = text.replace(':', '\\:')
    text = text.replace(',', '\\,')
    text = text.replace('%', '\\%')
    return text

def render_timeline(timeline, output_path, progress_callback=None):
    """
    Generates a single FFmpeg command to compile the timeline,
    runs it in a subprocess, and reports progress.
    """
    clips = timeline.get("clips", [])
    total_duration = float(timeline.get("duration", 10.0))
    
    if total_duration <= 0:
        total_duration = 5.0

    # Determine resolution from aspect ratio
    aspect_ratio = timeline.get("aspectRatio", "16:9")
    if aspect_ratio == "9:16":
        out_w, out_h = 720, 1280
    elif aspect_ratio == "1:1":
        out_w, out_h = 720, 720
    elif aspect_ratio == "4:3":
        out_w, out_h = 960, 720
    else: # 16:9
        out_w, out_h = 1280, 720

    # 1. Map unique media files to FFmpeg inputs
    # Input 0: Virtual black video background
    # Input 1: Virtual silent audio background
    # Input 2+: Media files
    input_index_map = {}
    inputs_args = [
        "-y",
        "-f", "lavfi", "-i", f"color=c=black:s={out_w}x{out_h}:r=30",
        "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"
    ]
    
    for clip in clips:
        clip_type = clip.get("type")
        if clip_type in ["video", "audio", "image"]:
            filepath = clip.get("filepath")
            if filepath and filepath not in input_index_map:
                in_idx = len(input_index_map) + 2
                input_index_map[filepath] = in_idx
                # Inspect file to determine if we should format input
                # For images, we can loop them as an input
                info = get_media_info(filepath)
                if info["is_image"]:
                    inputs_args.extend(["-loop", "1", "-i", filepath])
                else:
                    inputs_args.extend(["-i", filepath])

    # 2. Build the filter complex
    filter_complex_parts = []
    
    # Trim the base canvas video and audio
    filter_complex_parts.append(f"[0:v] trim=duration={total_duration},fps=30,setpts=PTS-STARTPTS [v_base]")
    filter_complex_parts.append(f"[1:a] atrim=duration={total_duration},asetpts=PTS-STARTPTS [a_base]")
    
    video_labels = ["[v_base]"]
    audio_labels = ["[a_base]"]
    
    for idx, clip in enumerate(clips):
        clip_type = clip.get("type")
        start = float(clip.get("start", 0.0))
        end = float(clip.get("end", start + 5.0))
        duration = end - start
        
        if duration <= 0:
            continue

        effects = clip.get("effects", {})
        transitions = clip.get("transitions", {})
        volume = float(clip.get("volume", 1.0))
        speed = float(clip.get("speed", 1.0))
        
        fadeIn = float(transitions.get("fadeIn", 0.0))
        fadeOut = float(transitions.get("fadeOut", 0.0))

        if clip_type == "video":
            filepath = clip.get("filepath")
            in_idx = input_index_map[filepath]
            info = get_media_info(filepath)
            
            clip_start = float(clip.get("clipStart", 0.0))
            clip_end = float(clip.get("clipEnd", clip_start + duration * speed))
            
            # Calculate default fit-centered size
            media_w = info.get("width", out_w)
            media_h = info.get("height", out_h)
            if media_w <= 0 or media_h <= 0:
                media_w, media_h = out_w, out_h
                
            media_ratio = media_w / media_h
            canvas_ratio = out_w / out_h
            if media_ratio > canvas_ratio:
                default_w = out_w
                default_h = int(out_w / media_ratio)
            else:
                default_h = out_h
                default_w = int(out_h * media_ratio)
            
            default_x = (out_w - default_w) // 2
            default_y = (out_h - default_h) // 2
            
            w = int(clip.get("width", default_w))
            h = int(clip.get("height", default_h))
            x = int(clip.get("x", default_x))
            y = int(clip.get("y", default_y))
            rot = float(clip.get("rotation", 0.0))

            # --- Video Stream Processing ---
            v_filters = []
            # Trim source
            v_filters.append(f"trim=start={clip_start}:end={clip_end},setpts=PTS-STARTPTS")
            # Normalize to timeline specs and scale to target size
            v_filters.append(f"fps=30,scale={w}:{h}")
            
            # Rotate if needed
            if rot != 0.0:
                v_filters.append(f"rotate={rot}*PI/180:c=black@0:ow=hypot(iw,ih):oh=ow")
                import math
                w_rot = math.hypot(w, h)
                x_pos = x + (w - w_rot) / 2.0
                y_pos = y + (h - w_rot) / 2.0
            else:
                x_pos = float(x)
                y_pos = float(y)
            
            # Speed effect
            if speed != 1.0:
                v_filters.append(f"setpts=1/{speed}*PTS")
                
            # Grayscale / Sepia / Brightness / Contrast
            if effects.get("grayscale"):
                v_filters.append("hue=s=0")
            elif effects.get("sepia"):
                v_filters.append("colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131")
                
            brightness = float(effects.get("brightness", 1.0))
            contrast = float(effects.get("contrast", 1.0))
            if brightness != 1.0 or contrast != 1.0:
                # eq expects brightness in range -1.0 to 1.0 (default 0)
                ffmpeg_brightness = brightness - 1.0
                v_filters.append(f"eq=brightness={ffmpeg_brightness}:contrast={contrast}")
                
            # Fades
            if fadeIn > 0:
                v_filters.append(f"fade=t=in:st=0:d={fadeIn}")
            if fadeOut > 0:
                v_filters.append(f"fade=t=out:st={duration - fadeOut}:d={fadeOut}")
                
            v_filter_str = ",".join(v_filters)
            filter_complex_parts.append(f"[{in_idx}:v] {v_filter_str} [clip_v_{idx}]")
            video_labels.append((f"[clip_v_{idx}]", start, end, x_pos, y_pos))
            
            # --- Audio Stream Processing ---
            if info["has_audio"]:
                a_filters = []
                # Trim source audio
                a_filters.append(f"atrim=start={clip_start}:end={clip_end},asetpts=PTS-STARTPTS")
                # Speed
                if speed != 1.0:
                    # atempo only supports 0.5 to 2.0.
                    # We bound it, but we can chain if needed.
                    spd = max(0.5, min(2.0, speed))
                    a_filters.append(f"atempo={spd}")
                # Volume
                if volume != 1.0:
                    a_filters.append(f"volume={volume}")
                # Fades
                if fadeIn > 0:
                    a_filters.append(f"afade=t=in:st=0:d={fadeIn}")
                if fadeOut > 0:
                    a_filters.append(f"afade=t=out:st={duration - fadeOut}:d={fadeOut}")
                # Delay to place on timeline
                start_ms = int(start * 1000)
                a_filters.append(f"adelay={start_ms}|{start_ms}")
                
                a_filter_str = ",".join(a_filters)
                filter_complex_parts.append(f"[{in_idx}:a] {a_filter_str} [clip_a_{idx}]")
                audio_labels.append(f"[clip_a_{idx}]")

        elif clip_type == "image":
            filepath = clip.get("filepath")
            in_idx = input_index_map[filepath]
            info = get_media_info(filepath)
            
            # Calculate default fit-centered size
            media_w = info.get("width", out_w)
            media_h = info.get("height", out_h)
            if media_w <= 0 or media_h <= 0:
                media_w, media_h = out_w, out_h
                
            media_ratio = media_w / media_h
            canvas_ratio = out_w / out_h
            if media_ratio > canvas_ratio:
                default_w = out_w
                default_h = int(out_w / media_ratio)
            else:
                default_h = out_h
                default_w = int(out_h * media_ratio)
            
            default_x = (out_w - default_w) // 2
            default_y = (out_h - default_h) // 2
            
            w = int(clip.get("width", default_w))
            h = int(clip.get("height", default_h))
            x = int(clip.get("x", default_x))
            y = int(clip.get("y", default_y))
            rot = float(clip.get("rotation", 0.0))
            
            # Since image is looped as an input, trim it to clip duration
            v_filters = []
            v_filters.append(f"trim=duration={duration},setpts=PTS-STARTPTS")
            v_filters.append(f"fps=30,scale={w}:{h}")
            
            # Rotate if needed
            if rot != 0.0:
                v_filters.append(f"rotate={rot}*PI/180:c=black@0:ow=hypot(iw,ih):oh=ow")
                import math
                w_rot = math.hypot(w, h)
                x_pos = x + (w - w_rot) / 2.0
                y_pos = y + (h - w_rot) / 2.0
            else:
                x_pos = float(x)
                y_pos = float(y)
            
            if effects.get("grayscale"):
                v_filters.append("hue=s=0")
            elif effects.get("sepia"):
                v_filters.append("colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131")
                
            brightness = float(effects.get("brightness", 1.0))
            contrast = float(effects.get("contrast", 1.0))
            if brightness != 1.0 or contrast != 1.0:
                ffmpeg_brightness = brightness - 1.0
                v_filters.append(f"eq=brightness={ffmpeg_brightness}:contrast={contrast}")
                
            if fadeIn > 0:
                v_filters.append(f"fade=t=in:st=0:d={fadeIn}")
            if fadeOut > 0:
                v_filters.append(f"fade=t=out:st={duration - fadeOut}:d={fadeOut}")
                
            v_filter_str = ",".join(v_filters)
            filter_complex_parts.append(f"[{in_idx}:v] {v_filter_str} [clip_v_{idx}]")
            video_labels.append((f"[clip_v_{idx}]", start, end, x_pos, y_pos))

        elif clip_type == "text":
            text_str = clip.get("text", "Text Overlay")
            escaped_text = escape_ffmpeg_filter_text(text_str)
            color = clip.get("color", "#ffffff").replace("#", "0x")
            # FFmpeg colors can be hex format: 0xffffff or white
            # If color is hex (like 0xffffff), make sure it has alpha if needed, or is valid.
            if len(color) == 8: # 0xRRGGBB
                pass
            
            font_size = int(clip.get("fontSize", 48))
            pos = clip.get("position", "center")
            
            if pos == "top":
                x_expr = "(w-text_w)/2"
                y_expr = "h/10"
            elif pos == "bottom":
                x_expr = "(w-text_w)/2"
                y_expr = "h-(h/10)-text_h"
            else: # center
                x_expr = "(w-text_w)/2"
                y_expr = "(h-text_h)/2"
                
            # Create a transparent base for text clip
            v_filters = []
            # We construct drawtext filter
            drawtext_filter = f"drawtext=text='{escaped_text}':font='Arial':fontsize={font_size}:fontcolor={color}:x={x_expr}:y={y_expr}"
            
            # Fades for text (drawtext alpha animation is complex, so we apply fade to the transparent layer itself)
            # A transparent layer color=c=black@0
            filter_complex_parts.append(f"color=c=black@0:s={out_w}x{out_h}:d={duration},fps=30,setpts=PTS-STARTPTS [txt_canvas_{idx}]")
            
            v_filters.append(drawtext_filter)
            if fadeIn > 0:
                v_filters.append(f"fade=t=in:st=0:d={fadeIn}:alpha=1")
            if fadeOut > 0:
                v_filters.append(f"fade=t=out:st={duration - fadeOut}:d={fadeOut}:alpha=1")
                
            v_filter_str = ",".join(v_filters)
            filter_complex_parts.append(f"[txt_canvas_{idx}] {v_filter_str} [clip_v_{idx}]")
            video_labels.append((f"[clip_v_{idx}]", start, end, 0.0, 0.0))

        elif clip_type == "audio":
            filepath = clip.get("filepath")
            in_idx = input_index_map[filepath]
            
            clip_start = float(clip.get("clipStart", 0.0))
            clip_end = float(clip.get("clipEnd", clip_start + duration * speed))
            
            a_filters = []
            a_filters.append(f"atrim=start={clip_start}:end={clip_end},asetpts=PTS-STARTPTS")
            if speed != 1.0:
                spd = max(0.5, min(2.0, speed))
                a_filters.append(f"atempo={spd}")
            if volume != 1.0:
                a_filters.append(f"volume={volume}")
            if fadeIn > 0:
                a_filters.append(f"afade=t=in:st=0:d={fadeIn}")
            if fadeOut > 0:
                a_filters.append(f"afade=t=out:st={duration - fadeOut}:d={fadeOut}")
            
            start_ms = int(start * 1000)
            a_filters.append(f"adelay={start_ms}|{start_ms}")
            
            a_filter_str = ",".join(a_filters)
            filter_complex_parts.append(f"[{in_idx}:a] {a_filter_str} [clip_a_{idx}]")
            audio_labels.append(f"[clip_a_{idx}]")

    # 3. Layer the video tracks using overlay filter sequentially
    # We sort visual clips by start time, so overlays apply chronologically
    visual_clips = [vl for vl in video_labels if isinstance(vl, tuple)]
    visual_clips.sort(key=lambda x: x[1]) # sort by start time
    
    curr_v_label = "[v_base]"
    for i, (clip_lbl, start, end, x_pos, y_pos) in enumerate(visual_clips):
        next_v_label = f"[v_overlay_{i}]"
        # Overlay the clip on top of the accumulated video using custom positions
        filter_complex_parts.append(
            f"{curr_v_label}{clip_lbl} overlay=x={x_pos:.1f}:y={y_pos:.1f}:enable='between(t,{start},{end})' {next_v_label}"
        )
        curr_v_label = next_v_label
    
    # 4. Mix the audio tracks using amix filter
    curr_a_label = "[a_base]"
    if len(audio_labels) > 1: # if we have audio clips in addition to the base silent audio
        # Combine all audio clips
        mix_inputs = "".join(audio_labels)
        num_inputs = len(audio_labels)
        # We multiply by volume=num_inputs because amix reduces volume of each track to 1/N.
        # This keeps the original clip volumes.
        filter_complex_parts.append(
            f"{mix_inputs} amix=inputs={num_inputs}:duration=first:dropout_transition=0,volume={num_inputs} [a_mixed]"
        )
        curr_a_label = "[a_mixed]"

    # 5. Assemble final command
    filter_complex_str = ";".join(filter_complex_parts)
    
    # Let's map the final video and audio stream labels to the output
    # The final video stream is curr_v_label (e.g. [v_overlay_N] or [v_base])
    # The final audio stream is curr_a_label (e.g. [a_mixed] or [a_base])
    
    cmd = []
    cmd.extend(inputs_args)
    cmd.extend([
        "-filter_complex", filter_complex_str,
        "-map", curr_v_label,
        "-map", curr_a_label,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "veryfast",
        "-c:a", "aac",
        "-shortest",
        output_path
    ])
    
    full_cmd = [get_ffmpeg_path()] + cmd
    
    print("Running FFmpeg command:")
    print(" ".join(full_cmd))
    
    # 6. Execute command and track progress
    # FFmpeg writes progress info to stderr. We capture it and parse it.
    process = subprocess.Popen(
        full_cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        universal_newlines=True
    )
    
    # Pattern to match duration/time
    # Example stderr output: "time=00:00:05.21"
    time_pattern = re.compile(r"time=(\d+):(\d+):(\d+\.\d+)")
    
    def parse_stderr():
        for line in process.stderr:
            match = time_pattern.search(line)
            if match:
                hours = int(match.group(1))
                minutes = int(match.group(2))
                seconds = float(match.group(3))
                current_time = hours * 3600 + minutes * 60 + seconds
                
                percent = min(100, int((current_time / total_duration) * 100))
                if progress_callback:
                    progress_callback(percent)
                    
    stderr_thread = threading.Thread(target=parse_stderr)
    stderr_thread.start()
    
    process.wait()
    stderr_thread.join()
    
    if progress_callback:
        if process.returncode == 0:
            progress_callback(100)
        else:
            progress_callback(-1) # indicates error
            
    return process.returncode == 0
