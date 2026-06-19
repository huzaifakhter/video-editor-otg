from flask import Flask, render_template, request, send_from_directory, jsonify
import os
import uuid
import threading
import json
import re
import time
import datetime
from video_processor import get_media_info, render_timeline

app = Flask(__name__)

PROJECTS_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "projects")
os.makedirs(PROJECTS_ROOT, exist_ok=True)

# Global dictionary to track render jobs
# Key: render_id, Value: {"status": "rendering"|"completed"|"failed", "progress": 0-100, "filename": ...}
render_jobs = {}

@app.route("/")
def home():
    return render_template("index.html")

# --- Project Management APIs ---

@app.route("/api/projects", methods=["GET"])
def list_projects():
    projects = []
    if os.path.exists(PROJECTS_ROOT):
        for name in os.listdir(PROJECTS_ROOT):
            project_dir = os.path.join(PROJECTS_ROOT, name)
            if os.path.isdir(project_dir):
                json_path = os.path.join(project_dir, "project.json")
                if os.path.exists(json_path):
                    try:
                        with open(json_path, "r", encoding="utf-8") as f:
                            data = json.load(f)
                        mtime = os.path.getmtime(json_path)
                        last_modified = datetime.datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M:%S")
                        
                        projects.append({
                            "id": name,
                            "name": data.get("name", name),
                            "aspectRatio": data.get("aspectRatio", "16:9"),
                            "duration": data.get("duration", 10.0),
                            "lastModified": last_modified
                        })
                    except Exception as e:
                        print(f"Error reading project.json in {name}: {e}")
    # Sort projects by last modified descending
    projects.sort(key=lambda x: x["lastModified"], reverse=True)
    return jsonify(projects)

@app.route("/api/projects/create", methods=["POST"])
def create_project():
    data = request.json or {}
    name = data.get("name", "Untitled Project").strip()
    aspect_ratio = data.get("aspectRatio", "16:9")
    
    if not name:
        name = "Untitled Project"
        
    # Generate unique ID slug: name_timestamp
    slug = re.sub(r'[^a-zA-Z0-9_\-]', '', name.lower().replace(" ", "-"))
    if not slug:
        slug = "project"
    project_id = f"{slug}_{int(time.time())}"
    
    project_dir = os.path.join(PROJECTS_ROOT, project_id)
    os.makedirs(project_dir, exist_ok=True)
    os.makedirs(os.path.join(project_dir, "uploads"), exist_ok=True)
    os.makedirs(os.path.join(project_dir, "outputs"), exist_ok=True)
    
    project_data = {
        "name": name,
        "aspectRatio": aspect_ratio,
        "duration": 10.0,
        "clips": [],
        "tracks": [
            { "id": "text-1", "type": "text", "icon": "fa-t" },
            { "id": "image-1", "type": "image", "icon": "fa-image" },
            { "id": "video-1", "type": "video", "icon": "fa-video" },
            { "id": "audio-1", "type": "audio", "icon": "fa-volume-high" }
        ]
    }
    
    json_path = os.path.join(project_dir, "project.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(project_data, f, indent=4)
        
    log_path = os.path.join(project_dir, "history.log")
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(log_path, "w", encoding="utf-8") as f:
        f.write(f"[{timestamp}] Project Created: '{name}' with aspect ratio {aspect_ratio}\n")
        
    return jsonify({
        "status": "success",
        "project_id": project_id,
        "project": project_data
    })

@app.route("/api/projects/<project_id>", methods=["GET"])
def get_project(project_id):
    project_dir = os.path.join(PROJECTS_ROOT, project_id)
    json_path = os.path.join(project_dir, "project.json")
    if not os.path.exists(json_path):
        return jsonify({"status": "error", "message": "Project not found"}), 404
        
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return jsonify(data)
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/api/projects/<project_id>/save", methods=["POST"])
def save_project(project_id):
    project_dir = os.path.join(PROJECTS_ROOT, project_id)
    json_path = os.path.join(project_dir, "project.json")
    if not os.path.exists(project_dir):
        return jsonify({"status": "error", "message": "Project not found"}), 404
        
    req_data = request.json or {}
    timeline = req_data.get("timeline")
    action_desc = req_data.get("actionDescription", "Modified settings")
    
    if not timeline:
        return jsonify({"status": "error", "message": "No timeline data provided"}), 400
        
    try:
        existing_name = "Untitled Project"
        if os.path.exists(json_path):
            with open(json_path, "r", encoding="utf-8") as f:
                try:
                    existing_data = json.load(f)
                    existing_name = existing_data.get("name", "Untitled Project")
                except Exception:
                    pass
        
        timeline["name"] = existing_name
        
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(timeline, f, indent=4)
            
        log_path = os.path.join(project_dir, "history.log")
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"[{timestamp}] Action: {action_desc}\n")
            
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# --- Project-Specific Asset Serving and Uploads ---

@app.route("/projects/<project_id>/upload", methods=["POST"])
def upload(project_id):
    if "file" not in request.files:
        return jsonify({"status": "error", "message": "No file part"}), 400
        
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"status": "error", "message": "No selected file"}), 400
        
    project_dir = os.path.join(PROJECTS_ROOT, project_id)
    upload_folder = os.path.join(project_dir, "uploads")
    os.makedirs(upload_folder, exist_ok=True)
    
    ext = os.path.splitext(file.filename)[1]
    safe_name = f"{uuid.uuid4()}{ext}"
    filepath = os.path.join(upload_folder, safe_name)
    
    file.save(filepath)
    metadata = get_media_info(filepath)
    
    # Log the upload to history
    log_path = os.path.join(project_dir, "history.log")
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(f"[{timestamp}] Action: Import file - Name: '{file.filename}', Filepath: '{filepath}'\n")

    return jsonify({
        "status": "success",
        "name": file.filename,
        "filename": safe_name,
        "filepath": filepath,
        "url": f"/projects/{project_id}/uploads/{safe_name}",
        "metadata": metadata
    })

@app.route("/projects/<project_id>/uploads/<filename>")
def serve_upload(project_id, filename):
    upload_folder = os.path.join(PROJECTS_ROOT, project_id, "uploads")
    return send_from_directory(upload_folder, filename)

@app.route("/projects/<project_id>/outputs/<filename>")
def serve_output(project_id, filename):
    output_folder = os.path.join(PROJECTS_ROOT, project_id, "outputs")
    return send_from_directory(output_folder, filename)

# --- Project-Specific Rendering ---

@app.route("/projects/<project_id>/render", methods=["POST"])
def render(project_id):
    timeline = request.json
    if not timeline:
        return jsonify({"status": "error", "message": "Invalid timeline data"}), 400
        
    project_dir = os.path.join(PROJECTS_ROOT, project_id)
    output_folder = os.path.join(project_dir, "outputs")
    os.makedirs(output_folder, exist_ok=True)
    
    render_id = str(uuid.uuid4())
    output_filename = f"render_{uuid.uuid4()}.mp4"
    output_path = os.path.join(output_folder, output_filename)
    
    render_jobs[render_id] = {
        "status": "rendering",
        "progress": 0,
        "filename": output_filename
    }
    
    def progress_callback(percent):
        if render_id in render_jobs:
            if percent == 100:
                render_jobs[render_id]["status"] = "completed"
                render_jobs[render_id]["progress"] = 100
            elif percent == -1:
                render_jobs[render_id]["status"] = "failed"
            else:
                render_jobs[render_id]["progress"] = percent
                
    def run_render():
        try:
            success = render_timeline(timeline, output_path, progress_callback)
            if success:
                # Log render success
                log_path = os.path.join(project_dir, "history.log")
                timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                with open(log_path, "a", encoding="utf-8") as f:
                    f.write(f"[{timestamp}] Action: Render Complete - Output: '{output_filename}'\n")
            else:
                render_jobs[render_id]["status"] = "failed"
        except Exception as e:
            print(f"Exception during render thread: {e}")
            render_jobs[render_id]["status"] = "failed"
            
    thread = threading.Thread(target=run_render)
    thread.start()
    
    # Log render start
    log_path = os.path.join(project_dir, "history.log")
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(f"[{timestamp}] Action: Start Render - Render ID: {render_id}\n")

    return jsonify({
        "status": "success",
        "render_id": render_id
    })

@app.route("/projects/<project_id>/render-status/<render_id>")
def render_status(project_id, render_id):
    job = render_jobs.get(render_id)
    if not job:
        return jsonify({"status": "error", "message": "Job not found"}), 404
        
    response = {
        "status": job["status"],
        "progress": job["progress"]
    }
    
    if job["status"] == "completed":
        response["output_url"] = f"/projects/{project_id}/outputs/{job['filename']}"
        
    return jsonify(response)

if __name__ == "__main__":
    app.run(debug=True, use_reloader=False)