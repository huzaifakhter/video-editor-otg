class PreviewManager {
    constructor() {
        this.currentTime = 0.0;
        this.totalDuration = 10.0;
        this.isPlaying = false;
        this.lastFrameTime = 0.0;
        
        // Map from clipId -> DOM element
        this.mediaElements = new Map();
        
        // Dom containers
        this.monitorContainer = document.getElementById("monitor-canvas-container");
        this.textContainer = document.getElementById("text-overlay-container");
        this.hiddenContainer = document.getElementById("hidden-preview-container");
        
        this.currentTimeCode = document.getElementById("current-time-code");
        this.totalTimeCode = document.getElementById("total-time-code");
        
        // Animation frame handler
        this.animationFrameId = null;
        
        // Monitor Zoom settings
        this.monitorZoom = 1.0;
        this.initMonitorZoom();
        this.initTransformControls();
    }

    setClips(clips) {
        // Sync clip DOM elements
        // 1. Remove elements for clips that no longer exist
        const clipIds = new Set(clips.map(c => c.id));
        for (const [clipId, element] of this.mediaElements.entries()) {
            if (!clipIds.has(clipId)) {
                element.pause && element.pause();
                element.remove();
                this.mediaElements.delete(clipId);
            }
        }

        // 2. Create or update DOM elements for current clips
        clips.forEach(clip => {
            if (clip.type === "video" || clip.type === "audio" || clip.type === "image") {
                if (!this.mediaElements.has(clip.id)) {
                    let element;
                    if (clip.type === "video") {
                        element = document.createElement("video");
                        element.src = clip.url;
                        element.preload = "auto";
                        element.playsInline = true;
                        element.muted = false; // We want to hear the audio preview
                        this.monitorContainer.appendChild(element);
                    } else if (clip.type === "audio") {
                        element = document.createElement("audio");
                        element.src = clip.url;
                        element.preload = "auto";
                        this.hiddenContainer.appendChild(element);
                    } else if (clip.type === "image") {
                        element = document.createElement("img");
                        element.src = clip.url;
                        this.monitorContainer.appendChild(element);
                    }
                    
                    if (clip.type === "video" || clip.type === "image") {
                        element.addEventListener("mousedown", (e) => {
                            e.stopPropagation();
                            if (window.appState) {
                                window.appState.selectClip(clip.id);
                            }
                        });
                        
                        if (clip.type === "video") {
                            const checkMeta = () => {
                                this.adjustClipToNaturalAspectRatio(clip, element);
                            };
                            element.addEventListener("loadedmetadata", checkMeta);
                            if (element.readyState >= 1) {
                                checkMeta();
                            }
                        } else if (clip.type === "image") {
                            const checkLoad = () => {
                                this.adjustClipToNaturalAspectRatio(clip, element);
                            };
                            element.addEventListener("load", checkLoad);
                            if (element.complete) {
                                checkLoad();
                            }
                        }
                    }
                    
                    this.mediaElements.set(clip.id, element);
                }
            }
        });
    }

    setTotalDuration(duration) {
        this.totalDuration = duration;
        this.totalTimeCode.textContent = this.formatTimeCode(duration);
    }

    play() {
        if (this.isPlaying) return;
        this.isPlaying = true;
        this.lastFrameTime = performance.now();
        this.tick();
        
        const playBtn = document.getElementById("btn-play-pause");
        if (playBtn) playBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
    }

    pause() {
        if (!this.isPlaying) return;
        this.isPlaying = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        
        // Pause all media elements
        for (const element of this.mediaElements.values()) {
            if (element.pause) element.pause();
        }
        
        const playBtn = document.getElementById("btn-play-pause");
        if (playBtn) playBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    }

    seek(time) {
        this.currentTime = Math.max(0.0, Math.min(this.totalDuration, time));
        this.currentTimeCode.textContent = this.formatTimeCode(this.currentTime);
        
        // Update playhead position on timeline
        if (window.timelineManager) {
            window.timelineManager.updatePlayheadPosition(this.currentTime);
        }
        
        this.updatePreviewState();
    }

    tick() {
        if (!this.isPlaying) return;
        
        const now = performance.now();
        const dt = (now - this.lastFrameTime) / 1000.0;
        this.lastFrameTime = now;
        
        this.currentTime += dt;
        
        if (this.currentTime >= this.totalDuration) {
            this.currentTime = 0.0;
            // Stop at end or loop
            this.pause();
            this.seek(0.0);
            return;
        }
        
        this.currentTimeCode.textContent = this.formatTimeCode(this.currentTime);
        
        if (window.timelineManager) {
            window.timelineManager.updatePlayheadPosition(this.currentTime);
        }
        
        this.updatePreviewState();
        
        this.animationFrameId = requestAnimationFrame(() => this.tick());
    }

    updatePreviewState() {
        if (!window.appState || !window.appState.timeline) return;
        
        const clips = window.appState.timeline.clips;
        const activeTextIds = new Set();
        
        clips.forEach(clip => {
            const start = clip.start;
            const end = clip.end;
            const duration = end - start;
            const isActive = this.currentTime >= start && this.currentTime <= end;
            
            const element = this.mediaElements.get(clip.id);
            
            if (clip.type === "video" || clip.type === "audio" || clip.type === "image") {
                if (!element) return;
                
                if (isActive) {
                    // Make visible (for video/image)
                    if (clip.type === "video" || clip.type === "image") {
                        element.classList.add("active");
                        
                        const ratio = window.appState.timeline.aspectRatio || "16:9";
                        let outW = 1280, outH = 720;
                        if (ratio === "9:16") { outW = 720; outH = 1280; }
                        else if (ratio === "1:1") { outW = 720; outH = 720; }
                        else if (ratio === "4:3") { outW = 960; outH = 720; }
                        
                        if (clip.x === undefined || clip.width === undefined) {
                            const mediaW = clip.metadata?.width || outW;
                            const mediaH = clip.metadata?.height || outH;
                            const mediaRatio = mediaW / mediaH;
                            const canvasRatio = outW / outH;
                            let w, h;
                            if (mediaRatio > canvasRatio) {
                                w = outW;
                                h = outW / mediaRatio;
                            } else {
                                h = outH;
                                w = outH * mediaRatio;
                            }
                            clip.x = Math.round((outW - w) / 2);
                            clip.y = Math.round((outH - h) / 2);
                            clip.width = Math.round(w);
                            clip.height = Math.round(h);
                            clip.rotation = 0;
                        }
                        
                        element.style.position = 'absolute';
                        element.style.maxWidth = 'none';
                        element.style.maxHeight = 'none';
                        element.style.objectFit = 'fill';
                        element.style.left = `${(clip.x / outW) * 100}%`;
                        element.style.top = `${(clip.y / outH) * 100}%`;
                        element.style.width = `${(clip.width / outW) * 100}%`;
                        element.style.height = `${(clip.height / outH) * 100}%`;
                        element.style.transform = `rotate(${clip.rotation || 0}deg)`;
                    }
                    
                    // Apply CSS Filter Effects
                    if (clip.type === "video" || clip.type === "image") {
                        element.style.filter = this.getCSSFilterString(clip.effects);
                    }
                    
                    // Apply volume
                    if (element.volume !== undefined) {
                        element.volume = clip.volume !== undefined ? clip.volume : 1.0;
                    }
                    
                    // Apply fade transitions to video/image using opacity
                    if (clip.type === "video" || clip.type === "image") {
                        let opacity = 1.0;
                        const relativeTime = this.currentTime - start;
                        const fadeIn = clip.transitions?.fadeIn || 0.0;
                        const fadeOut = clip.transitions?.fadeOut || 0.0;
                        
                        if (relativeTime < fadeIn && fadeIn > 0) {
                            opacity = relativeTime / fadeIn;
                        } else if (end - this.currentTime < fadeOut && fadeOut > 0) {
                            opacity = (end - this.currentTime) / fadeOut;
                        }
                        element.style.opacity = opacity;
                    }
                    
                    // Handle sync and playback
                    if (clip.type === "video" || clip.type === "audio") {
                        const relativeTime = this.currentTime - start;
                        const speed = clip.speed || 1.0;
                        const clipStart = clip.clipStart || 0.0;
                        const targetSourceTime = clipStart + (relativeTime * speed);
                        
                        element.playbackRate = speed;
                        
                        if (this.isPlaying) {
                            // If it's not playing, start it
                            if (element.paused) {
                                element.play().catch(e => console.log("Playback blocked:", e));
                            }
                            
                            // If out of sync, snap
                            if (Math.abs(element.currentTime - targetSourceTime) > 0.15) {
                                element.currentTime = targetSourceTime;
                            }
                        } else {
                            if (!element.paused) {
                                element.pause();
                            }
                            element.currentTime = targetSourceTime;
                        }
                    }
                } else {
                    // Inactive clip
                    if (clip.type === "video" || clip.type === "image") {
                        element.classList.remove("active");
                    }
                    if (element.pause && !element.paused) {
                        element.pause();
                    }
                }
            } else if (clip.type === "text") {
                if (isActive) {
                    activeTextIds.add(clip.id);
                    let txtEl = document.getElementById(`preview-text-${clip.id}`);
                    if (!txtEl) {
                        txtEl = document.createElement("div");
                        txtEl.id = `preview-text-${clip.id}`;
                        txtEl.className = "text-overlay-item";
                        this.textContainer.appendChild(txtEl);
                    }
                    
                    // Apply visual styling
                    txtEl.textContent = clip.text;
                    txtEl.style.fontSize = `${clip.fontSize}px`;
                    txtEl.style.color = clip.color;
                    
                    // Position
                    if (clip.position === "top") {
                        txtEl.style.top = "10%";
                        txtEl.style.bottom = "auto";
                    } else if (clip.position === "bottom") {
                        txtEl.style.bottom = "10%";
                        txtEl.style.top = "auto";
                    } else {
                        txtEl.style.top = "50%";
                        txtEl.style.transform = "translate(-50%, -50%)";
                        txtEl.style.bottom = "auto";
                    }
                    
                    // Fade Transitions
                    let opacity = 1.0;
                    const relativeTime = this.currentTime - start;
                    const fadeIn = clip.fadeIn || 0.0;
                    const fadeOut = clip.fadeOut || 0.0;
                    if (relativeTime < fadeIn && fadeIn > 0) {
                        opacity = relativeTime / fadeIn;
                    } else if (end - this.currentTime < fadeOut && fadeOut > 0) {
                        opacity = (end - this.currentTime) / fadeOut;
                    }
                    txtEl.style.opacity = opacity;
                    txtEl.classList.add("active");
                } else {
                    const txtEl = document.getElementById(`preview-text-${clip.id}`);
                    if (txtEl) {
                        txtEl.classList.remove("active");
                        txtEl.remove();
                    }
                }
            }
        });
        
        // Clean up text overlays that are no longer active
        const allTextElements = this.textContainer.querySelectorAll(".text-overlay-item");
        allTextElements.forEach(el => {
            const id = el.id.replace("preview-text-", "");
            if (!activeTextIds.has(id)) {
                el.remove();
            }
        });

        // Update Transform Box visibility & dimensions
        const transformBox = document.getElementById("clip-transform-box");
        if (transformBox) {
            let shown = false;
            if (window.appState && window.appState.selectedClipId) {
                const clip = clips.find(c => c.id === window.appState.selectedClipId);
                if (clip && (clip.type === "video" || clip.type === "image")) {
                    const isActive = this.currentTime >= clip.start && this.currentTime <= clip.end;
                    if (isActive) {
                        const ratio = window.appState.timeline.aspectRatio || "16:9";
                        let outW = 1280, outH = 720;
                        if (ratio === "9:16") { outW = 720; outH = 1280; }
                        else if (ratio === "1:1") { outW = 720; outH = 720; }
                        else if (ratio === "4:3") { outW = 960; outH = 720; }

                        if (clip.x !== undefined && clip.width !== undefined) {
                            transformBox.style.left = `${(clip.x / outW) * 100}%`;
                            transformBox.style.top = `${(clip.y / outH) * 100}%`;
                            transformBox.style.width = `${(clip.width / outW) * 100}%`;
                            transformBox.style.height = `${(clip.height / outH) * 100}%`;
                            transformBox.style.transform = `rotate(${clip.rotation || 0}deg)`;
                            transformBox.style.display = "block";
                            shown = true;
                        }
                    }
                }
            }
            if (!shown) {
                transformBox.style.display = "none";
            }
        }
    }

    getCSSFilterString(effects) {
        if (!effects) return 'none';
        let filters = [];
        if (effects.grayscale) filters.push('grayscale(100%)');
        if (effects.sepia) filters.push('sepia(100%)');
        if (effects.brightness !== undefined && effects.brightness !== 1.0) {
            filters.push(`brightness(${effects.brightness})`);
        }
        if (effects.contrast !== undefined && effects.contrast !== 1.0) {
            filters.push(`contrast(${effects.contrast})`);
        }
        return filters.length > 0 ? filters.join(' ') : 'none';
    }

    formatTimeCode(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 100);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
    }

    initMonitorZoom() {
        const previewPanel = document.getElementById("panel-preview");
        if (!previewPanel) return;

        this.panX = 0;
        this.panY = 0;
        this.isPanning = false;
        this.startX = 0;
        this.startY = 0;

        previewPanel.addEventListener("wheel", (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
                e.stopPropagation();

                const delta = e.deltaY < 0 ? 0.1 : -0.1;
                this.monitorZoom = Math.max(0.1, Math.min(10.0, this.monitorZoom + delta));
                
                if (this.monitorZoom === 1.0) {
                    this.panX = 0;
                    this.panY = 0;
                }
                this.applyMonitorZoom();
            }
        }, { passive: false });

        // Double-click on preview panel to reset zoom
        previewPanel.addEventListener("dblclick", (e) => {
            if (e.target.closest("button") || e.target.closest("input")) return;
            this.monitorZoom = 1.0;
            this.panX = 0;
            this.panY = 0;
            this.applyMonitorZoom();
        });

        // Drag to pan
        const wrapper = document.querySelector(".monitor-wrapper");
        if (wrapper) {
            wrapper.addEventListener("mousedown", (e) => {
                if (e.button !== 0) return; // Only left click
                if (e.target.closest("button") || e.target.closest("input")) return;
                this.isPanning = true;
                this.startX = e.clientX - this.panX;
                this.startY = e.clientY - this.panY;
                this.applyMonitorZoom();
            });

            window.addEventListener("mousemove", (e) => {
                if (!this.isPanning) return;
                this.panX = e.clientX - this.startX;
                this.panY = e.clientY - this.startY;
                this.applyMonitorZoom();
            });

            window.addEventListener("mouseup", () => {
                if (this.isPanning) {
                    this.isPanning = false;
                    this.applyMonitorZoom();
                }
            });
        }
    }

    applyMonitorZoom() {
        const monitor = document.getElementById("video-monitor");
        if (monitor) {
            monitor.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.monitorZoom})`;
            monitor.style.transformOrigin = "center center";
        }

        const badge = document.getElementById("monitor-zoom-badge");
        if (badge) {
            badge.textContent = `${Math.round(this.monitorZoom * 100)}%`;
        }

        const wrapper = document.querySelector(".monitor-wrapper");
        if (wrapper) {
            if (this.monitorZoom !== 1.0) {
                wrapper.style.cursor = this.isPanning ? "grabbing" : "grab";
            } else {
                wrapper.style.cursor = "default";
            }
        }
    }

    updateAspectRatio(ratio) {
        const monitor = document.getElementById("video-monitor");
        if (monitor) {
            const cssRatio = ratio.replace(":", " / ");
            monitor.style.aspectRatio = cssRatio;
            
            // Re-center on aspect ratio change
            this.monitorZoom = 1.0;
            this.panX = 0;
            this.panY = 0;
            this.applyMonitorZoom();
        }
    }

    getCanvasDimensions(ratio) {
        if (ratio === "9:16") return { w: 720, h: 1280 };
        if (ratio === "1:1") return { w: 720, h: 720 };
        if (ratio === "4:3") return { w: 960, h: 720 };
        return { w: 1280, h: 720 }; // 16:9 default
    }

    adjustClipToNaturalAspectRatio(clip, element) {
        let mediaW = 0;
        let mediaH = 0;
        
        if (clip.type === "video") {
            mediaW = element.videoWidth;
            mediaH = element.videoHeight;
        } else if (clip.type === "image") {
            mediaW = element.naturalWidth;
            mediaH = element.naturalHeight;
        }
        
        if (mediaW > 0 && mediaH > 0) {
            const currentRatio = clip.width / clip.height;
            const naturalRatio = mediaW / mediaH;
            
            if (Math.abs(currentRatio - naturalRatio) > 0.01) {
                // Adjust height to preserve natural aspect ratio based on current width
                clip.height = Math.round(clip.width / naturalRatio);
                
                this.updatePreviewState();
                if (window.appState) {
                    window.appState.saveTimelineState("Adjust clip to natural aspect ratio");
                }
            }
        }
    }

    initTransformControls() {
        const transformBox = document.getElementById("clip-transform-box");
        if (!transformBox) return;

        let dragMode = null; // 'move', 'rotate', or corner name
        let startX = 0, startY = 0;
        let initialX = 0, initialY = 0, initialW = 0, initialH = 0, initialRot = 0;
        let aspectRatio = 1.0;
        let clip = null;

        const onMouseDown = (e) => {
            if (!window.appState || !window.appState.selectedClipId) return;
            clip = window.appState.timeline.clips.find(c => c.id === window.appState.selectedClipId);
            if (!clip || (clip.type !== "video" && clip.type !== "image")) return;

            // Don't trigger if it is not on the transform-box or its anchors
            if (e.target !== transformBox && !e.target.closest("[data-anchor]")) return;

            e.preventDefault();
            e.stopPropagation();

            const anchor = e.target.closest("[data-anchor]");
            dragMode = anchor ? anchor.dataset.anchor : 'move';

            startX = e.clientX;
            startY = e.clientY;

            initialX = clip.x;
            initialY = clip.y;
            initialW = clip.width;
            initialH = clip.height;
            initialRot = clip.rotation || 0;
            aspectRatio = initialW / initialH;
            
            if (dragMode === 'rotate') {
                const rotateBtn = transformBox.querySelector("[data-anchor='rotate']");
                if (rotateBtn) rotateBtn.style.cursor = 'grabbing';
            }

            window.addEventListener("mousemove", onMouseMove);
            window.addEventListener("mouseup", onMouseUp);
        };

        const onMouseMove = (e) => {
            if (!clip) return;

            const monitor = document.getElementById("video-monitor");
            if (!monitor) return;

            const ratio = window.appState.timeline.aspectRatio || "16:9";
            const { w: outW, h: outH } = this.getCanvasDimensions(ratio);

            const cssWidth = monitor.clientWidth;
            const canvasToCssRatio = outW / cssWidth;

            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            // Delta in canvas pixels
            const canvasDx = (dx / this.monitorZoom) * canvasToCssRatio;
            const canvasDy = (dy / this.monitorZoom) * canvasToCssRatio;

            if (dragMode === 'move') {
                clip.x = Math.round(initialX + canvasDx);
                clip.y = Math.round(initialY + canvasDy);
            } else if (dragMode === 'rotate') {
                const monitorRect = monitor.getBoundingClientRect();
                const cx = initialX + initialW / 2;
                const cy = initialY + initialH / 2;

                const screenCx = monitorRect.left + (cx / outW) * monitorRect.width;
                const screenCy = monitorRect.top + (cy / outH) * monitorRect.height;

                const angleRad = Math.atan2(e.clientY - screenCy, e.clientX - screenCx);
                let rotationDegrees = (angleRad + Math.PI / 2) * 180 / Math.PI;
                rotationDegrees = Math.round(rotationDegrees) % 360;
                if (rotationDegrees < 0) rotationDegrees += 360;

                clip.rotation = rotationDegrees;
            } else {
                // Resize corners
                const theta = (initialRot * Math.PI) / 180;
                const cos = Math.cos(theta);
                const sin = Math.sin(theta);

                // Project mouse movement to clip local axes
                const deltaRight = canvasDx * cos + canvasDy * sin;
                const deltaDown = -canvasDx * sin + canvasDy * cos;

                let nw = initialW;
                let nh = initialH;
                let new_local_ox = 0;
                let new_local_oy = 0;

                // Opposite anchor position in canvas coordinates
                const cx = initialX + initialW / 2;
                const cy = initialY + initialH / 2;
                let local_ox = 0, local_oy = 0;

                if (dragMode === 'bottom-right') {
                    nw = Math.max(20, initialW + deltaRight);
                    nh = nw / aspectRatio;
                    local_ox = -initialW / 2;
                    local_oy = -initialH / 2;
                    new_local_ox = -nw / 2;
                    new_local_oy = -nh / 2;
                } else if (dragMode === 'bottom-left') {
                    nw = Math.max(20, initialW - deltaRight);
                    nh = nw / aspectRatio;
                    local_ox = initialW / 2;
                    local_oy = -initialH / 2;
                    new_local_ox = nw / 2;
                    new_local_oy = -nh / 2;
                } else if (dragMode === 'top-right') {
                    nw = Math.max(20, initialW + deltaRight);
                    nh = nw / aspectRatio;
                    local_ox = -initialW / 2;
                    local_oy = initialH / 2;
                    new_local_ox = -nw / 2;
                    new_local_oy = nh / 2;
                } else if (dragMode === 'top-left') {
                    nw = Math.max(20, initialW - deltaRight);
                    nh = nw / aspectRatio;
                    local_ox = initialW / 2;
                    local_oy = initialH / 2;
                    new_local_ox = nw / 2;
                    new_local_oy = nh / 2;
                }

                // Calculate fixed opposite anchor position
                const ox = cx + (local_ox * cos - local_oy * sin);
                const oy = cy + (local_ox * sin + local_oy * cos);

                // Calculate new center
                const new_cx = ox - (new_local_ox * cos - new_local_oy * sin);
                const new_cy = oy - (new_local_ox * sin + new_local_oy * cos);

                clip.width = Math.round(nw);
                clip.height = Math.round(nh);
                clip.x = Math.round(new_cx - nw / 2);
                clip.y = Math.round(new_cy - nh / 2);
            }

            this.updatePreviewState();
            
            // Sync readouts in properties panel if showing
            if (window.appState) {
                const xIn = document.getElementById("prop-x");
                const yIn = document.getElementById("prop-y");
                const wIn = document.getElementById("prop-w");
                const hIn = document.getElementById("prop-h");
                const rotIn = document.getElementById("prop-rot");
                const rotVal = document.getElementById("val-rot");
                
                if (xIn) xIn.value = clip.x;
                if (yIn) yIn.value = clip.y;
                if (wIn) wIn.value = clip.width;
                if (hIn) hIn.value = clip.height;
                if (rotIn) {
                    rotIn.value = clip.rotation;
                    if (rotVal) rotVal.textContent = `${clip.rotation}°`;
                }
            }
        };

        const onMouseUp = () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);

            const rotateBtn = transformBox.querySelector("[data-anchor='rotate']");
            if (rotateBtn) rotateBtn.style.cursor = 'grab';

            dragMode = null;
            clip = null;

            if (window.appState) {
                window.appState.saveTimelineState("Transform clip");
            }
        };

        transformBox.addEventListener("mousedown", onMouseDown);
    }
}
window.previewManager = new PreviewManager();
