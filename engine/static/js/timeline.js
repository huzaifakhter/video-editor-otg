class TimelineManager {
    constructor() {
        this.zoom = 25; // pixels per second
        this.maxDuration = 60.0; // max timeline duration (will expand dynamically)
        
        // Elements
        this.workspace = document.getElementById("timeline-workspace");
        this.rulerContainer = document.getElementById("timeline-ruler-container");
        this.rulerCanvas = document.getElementById("timeline-ruler");
        this.playhead = document.getElementById("timeline-playhead");
        
        this.tracksContainer = document.getElementById("timeline-tracks-container");
        
        this.zoomSlider = document.getElementById("timeline-zoom");
        this.resizer = document.getElementById("timeline-resizer");
        
        // State
        this.dragState = null; // { clipId, type: 'move'|'trim-left'|'trim-right', startX, initialStart, initialEnd, initialClipStart }
        
        this.initEventListeners();
        this.resizeRuler();
    }

    initEventListeners() {
        // Vertical Timeline Resizing
        let isResizing = false;
        this.resizer.addEventListener("mousedown", (e) => {
            e.preventDefault();
            isResizing = true;
            this.resizer.classList.add("active");
        });

        window.addEventListener("mousemove", (e) => {
            if (isResizing) {
                const newHeight = window.innerHeight - e.clientY;
                if (newHeight >= 120 && newHeight <= 500) {
                    document.documentElement.style.setProperty('--timeline-height', `${newHeight}px`);
                    this.resizeRuler();
                }
            }
        });

        window.addEventListener("mouseup", () => {
            if (isResizing) {
                isResizing = false;
                this.resizer.classList.remove("active");
            }
        });

        // Zoom slider
        this.zoomSlider.addEventListener("input", (e) => {
            this.zoom = parseInt(e.target.value);
            this.render();
            window.previewManager.updatePreviewState();
        });

        // Timeline Zoom with Ctrl + Scroll Wheel (preventing page zoom)
        const timelineFooter = document.getElementById("app-timeline");
        timelineFooter.addEventListener("wheel", (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
                e.stopPropagation();
                let delta = e.deltaY < 0 ? 5 : -5;
                let newZoom = Math.max(5, Math.min(100, this.zoom + delta));
                if (newZoom !== this.zoom) {
                    this.zoom = newZoom;
                    this.zoomSlider.value = this.zoom;
                    this.render();
                    window.previewManager.updatePreviewState();
                }
            }
        }, { passive: false });
        
        // Ruler and Workspace seeking
        const handleSeek = (e) => {
            const rect = this.workspace.getBoundingClientRect();
            // Need to account for the track header (68px) and scrolling
            const clickX = e.clientX - rect.left - 68 + this.workspace.scrollLeft;
            const time = Math.max(0, clickX / this.zoom);
            window.previewManager.seek(time);
        };

        let isSeeking = false;
        this.rulerContainer.addEventListener("mousedown", (e) => {
            isSeeking = true;
            handleSeek(e);
        });
        
        window.addEventListener("mousemove", (e) => {
            if (isSeeking) {
                handleSeek(e);
            } else if (this.dragState) {
                this.handleDragMove(e);
            }
        });

        window.addEventListener("mouseup", () => {
            isSeeking = false;
            if (this.dragState) {
                this.dragState = null;
                // Save state to local storage or backend if needed
                if (window.appState) window.appState.saveTimelineState("Move/Trim clip");
            }
        });
        
        // Window resize
        window.addEventListener("resize", () => {
            this.resizeRuler();
        });
        
        // Scroll syncing for ruler
        this.workspace.addEventListener("scroll", () => {
            this.rulerCanvas.style.transform = `translateX(-${this.workspace.scrollLeft}px)`;
        });
    }

    setMaxDuration(duration) {
        this.maxDuration = Math.max(60.0, duration + 10.0);
        this.resizeRuler();
    }

    resizeRuler() {
        // Match ruler canvas size to workspace width
        const width = Math.max(this.workspace.clientWidth - 68, this.maxDuration * this.zoom);
        this.rulerCanvas.width = width;
        this.drawRuler();
    }

    drawRuler() {
        const ctx = this.rulerCanvas.getContext("2d");
        const width = this.rulerCanvas.width;
        const height = this.rulerCanvas.height;
        
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = "#1e2024";
        ctx.fillRect(0, 0, width, height);
        
        ctx.strokeStyle = "#4b5563";
        ctx.fillStyle = "#9ca3af";
        ctx.font = "9px Outfit, sans-serif";
        ctx.lineWidth = 1;
        
        const secStep = 1;
        const majorSecStep = 5;
        
        for (let t = 0; t <= this.maxDuration; t += secStep) {
            const x = t * this.zoom;
            ctx.beginPath();
            if (t % majorSecStep === 0) {
                // Major tick
                ctx.moveTo(x, 8);
                ctx.lineTo(x, height);
                // Draw text label
                const mins = Math.floor(t / 60);
                const secs = t % 60;
                const timeStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
                ctx.fillText(timeStr, x + 4, 15);
            } else {
                // Minor tick
                ctx.moveTo(x, 16);
                ctx.lineTo(x, height);
            }
            ctx.stroke();
        }
    }

    updatePlayheadPosition(time) {
        // Adjust for track header width (68px)
        const x = 68 + time * this.zoom;
        this.playhead.style.left = `${x}px`;
    }

    render() {
        if (!window.appState || !window.appState.timeline) return;
        
        const clips = window.appState.timeline.clips;
        const tracks = window.appState.timeline.tracks || [];
        
        // Dynamically build track HTML
        this.tracksContainer.innerHTML = tracks.map(track => `
            <div class="track-row" data-track-id="${track.id}" data-track-type="${track.type}">
                <div class="track-header" title="${track.type} Track">
                    <i class="fa-solid ${track.icon}"></i>
                    <button class="delete-track-btn" title="Delete Track" onclick="event.stopPropagation(); window.appState.deleteTrack('${track.id}')">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div class="track-body" id="track-body-${track.id}"></div>
            </div>
        `).join('');
        
        // Recalculate max duration to ensure timeline has enough space
        let maxEndTime = 10.0;
        clips.forEach(clip => {
            if (clip.end > maxEndTime) maxEndTime = clip.end;
        });
        
        this.maxDuration = Math.max(60.0, maxEndTime + 10.0);
        this.resizeRuler();
        
        // Render each clip
        clips.forEach(clip => {
            const clipEl = document.createElement("div");
            clipEl.className = `timeline-clip clip-${clip.type}`;
            if (window.appState.selectedClipId === clip.id) {
                clipEl.classList.add("selected");
            }
            
            // Positioning
            const left = clip.start * this.zoom;
            const width = (clip.end - clip.start) * this.zoom;
            clipEl.style.left = `${left}px`;
            clipEl.style.width = `${width}px`;
            
            // Title & duration info
            const titleEl = document.createElement("span");
            titleEl.className = "clip-title";
            titleEl.textContent = clip.type === "text" ? `"${clip.text}"` : clip.name;
            
            const durTag = document.createElement("span");
            durTag.className = "clip-duration-tag";
            durTag.textContent = `${(clip.end - clip.start).toFixed(1)}s`;
            
            clipEl.appendChild(titleEl);
            clipEl.appendChild(durTag);
            
            // Trim handles
            const handleLeft = document.createElement("div");
            handleLeft.className = "clip-handle clip-handle-left";
            handleLeft.innerHTML = '<i class="fa-solid fa-grip-vertical"></i>';
            
            const handleRight = document.createElement("div");
            handleRight.className = "clip-handle clip-handle-right";
            handleRight.innerHTML = '<i class="fa-solid fa-grip-vertical"></i>';
            
            clipEl.appendChild(handleLeft);
            clipEl.appendChild(handleRight);
            
            // Mouse event handlers for dragging/trimming
            clipEl.addEventListener("mousedown", (e) => {
                e.stopPropagation();
                window.appState.selectClip(clip.id);
                
                let type = 'move';
                if (e.target.closest(".clip-handle-left")) {
                    type = 'trim-left';
                } else if (e.target.closest(".clip-handle-right")) {
                    type = 'trim-right';
                }
                
                this.dragState = {
                    clipId: clip.id,
                    type: type,
                    startX: e.clientX,
                    initialStart: clip.start,
                    initialEnd: clip.end,
                    initialClipStart: clip.clipStart || 0.0,
                    sourceMaxDuration: clip.sourceDuration || 9999.0
                };
            });
            
            // Append to dynamic track body
            const trackBody = document.getElementById(`track-body-${clip.trackId}`);
            if (trackBody) {
                trackBody.appendChild(clipEl);
            } else {
                // Fallback if track doesn't exist
                const fallbackTrack = tracks.find(t => t.type === clip.type) || tracks[0];
                if (fallbackTrack) {
                    clip.trackId = fallbackTrack.id;
                    const fallbackBody = document.getElementById(`track-body-${fallbackTrack.id}`);
                    if (fallbackBody) fallbackBody.appendChild(clipEl);
                }
            }
        });
    }

    handleDragMove(e) {
        if (!this.dragState) return;
        
        const dx = e.clientX - this.dragState.startX;
        const dt = dx / this.zoom;
        
        const clip = window.appState.timeline.clips.find(c => c.id === this.dragState.clipId);
        if (!clip) return;

        // Dynamic track detection during dragging
        const trackRows = Array.from(document.querySelectorAll(".track-row"));
        const hoveredRow = trackRows.find(row => {
            const rect = row.getBoundingClientRect();
            return e.clientY >= rect.top && e.clientY <= rect.bottom;
        });
        if (hoveredRow) {
            const newTrackId = hoveredRow.dataset.trackId;
            const newTrackType = hoveredRow.dataset.trackType;
            let isCompatible = false;
            if (clip.type === "video" || clip.type === "image") {
                isCompatible = (newTrackType === "video" || newTrackType === "image");
            } else {
                isCompatible = (newTrackType === clip.type);
            }
            
            if (isCompatible && clip.trackId !== newTrackId) {
                clip.trackId = newTrackId;
            }
        }
        
        const speed = clip.speed || 1.0;
        
        // Define snap targets (playhead + other clips' start/end times)
        let targets = [];
        if (window.appState && window.appState.snapEnabled) {
            const snapThreshold = 12 / this.zoom; // 12 pixels threshold in seconds
            
            // Add playhead time
            if (window.previewManager) {
                targets.push(window.previewManager.currentTime);
            }
            
            // Add other clips' bounds
            window.appState.timeline.clips.forEach(c => {
                if (c.id !== clip.id) {
                    targets.push(c.start);
                    targets.push(c.end);
                }
            });
            
            if (this.dragState.type === 'move') {
                const duration = this.dragState.initialEnd - this.dragState.initialStart;
                let proposedStart = this.dragState.initialStart + dt;
                let proposedEnd = proposedStart + duration;
                
                // Find closest snap target for start
                let bestSnapStart = null;
                let minDiffStart = snapThreshold;
                targets.forEach(t => {
                    const diff = Math.abs(proposedStart - t);
                    if (diff < minDiffStart) {
                        minDiffStart = diff;
                        bestSnapStart = t;
                    }
                });
                
                // Find closest snap target for end
                let bestSnapEnd = null;
                let minDiffEnd = snapThreshold;
                targets.forEach(t => {
                    const diff = Math.abs(proposedEnd - t);
                    if (diff < minDiffEnd) {
                        minDiffEnd = diff;
                        bestSnapEnd = t;
                    }
                });
                
                if (bestSnapStart !== null && (bestSnapEnd === null || minDiffStart <= minDiffEnd)) {
                    // Snap clip start
                    clip.start = bestSnapStart;
                    clip.end = clip.start + duration;
                } else if (bestSnapEnd !== null) {
                    // Snap clip end
                    clip.end = bestSnapEnd;
                    clip.start = clip.end - duration;
                } else {
                    // No snap, normal bounded movement
                    clip.start = Math.max(0.0, proposedStart);
                    clip.end = clip.start + duration;
                }
            } else if (this.dragState.type === 'trim-left') {
                let proposedStart = this.dragState.initialStart + dt;
                proposedStart = Math.max(0.0, Math.min(proposedStart, this.dragState.initialEnd - 0.5));
                
                // Find snap target for start
                let bestSnap = null;
                let minDiff = snapThreshold;
                targets.forEach(t => {
                    if (t < this.dragState.initialEnd) {
                        const diff = Math.abs(proposedStart - t);
                        if (diff < minDiff) {
                            minDiff = diff;
                            bestSnap = t;
                        }
                    }
                });
                
                let finalStart = bestSnap !== null ? bestSnap : proposedStart;
                const actualDt = finalStart - this.dragState.initialStart;
                const sourceDt = actualDt * speed;
                const newClipStart = this.dragState.initialClipStart + sourceDt;
                
                if (newClipStart >= 0.0) {
                    clip.start = finalStart;
                    clip.clipStart = newClipStart;
                }
            } else if (this.dragState.type === 'trim-right') {
                let proposedEnd = this.dragState.initialEnd + dt;
                proposedEnd = Math.max(this.dragState.initialStart + 0.5, proposedEnd);
                
                // Find snap target for end
                let bestSnap = null;
                let minDiff = snapThreshold;
                targets.forEach(t => {
                    if (t > this.dragState.initialStart) {
                        const diff = Math.abs(proposedEnd - t);
                        if (diff < minDiff) {
                            minDiff = diff;
                            bestSnap = t;
                        }
                    }
                });
                
                let finalEnd = bestSnap !== null ? bestSnap : proposedEnd;
                const duration = finalEnd - clip.start;
                const newClipEnd = (clip.clipStart || 0.0) + (duration * speed);
                
                if (clip.type === "text" || newClipEnd <= this.dragState.sourceMaxDuration) {
                    clip.end = finalEnd;
                    clip.clipEnd = newClipEnd;
                }
            }
        } else {
            // Normal dragging code (without snapping)
            if (this.dragState.type === 'move') {
                const duration = this.dragState.initialEnd - this.dragState.initialStart;
                let newStart = this.dragState.initialStart + dt;
                newStart = Math.max(0.0, newStart);
                
                clip.start = newStart;
                clip.end = newStart + duration;
            } else if (this.dragState.type === 'trim-left') {
                let newStart = this.dragState.initialStart + dt;
                newStart = Math.max(0.0, Math.min(newStart, this.dragState.initialEnd - 0.5));
                const actualDt = newStart - this.dragState.initialStart;
                const sourceDt = actualDt * speed;
                const newClipStart = this.dragState.initialClipStart + sourceDt;
                
                if (newClipStart >= 0.0) {
                    clip.start = newStart;
                    clip.clipStart = newClipStart;
                }
            } else if (this.dragState.type === 'trim-right') {
                let newEnd = this.dragState.initialEnd + dt;
                newEnd = Math.max(this.dragState.initialStart + 0.5, newEnd);
                const duration = newEnd - clip.start;
                const newClipEnd = (clip.clipStart || 0.0) + (duration * speed);
                
                if (clip.type === "text" || newClipEnd <= this.dragState.sourceMaxDuration) {
                    clip.end = newEnd;
                    clip.clipEnd = newClipEnd;
                }
            }
        }
        
        // Refresh UI & preview without full render for performance
        this.render();
        window.previewManager.updatePreviewState();
    }
}
window.timelineManager = new TimelineManager();
