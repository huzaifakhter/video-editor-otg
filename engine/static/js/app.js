class AppState {
    constructor() {
        this.timeline = {
            duration: 10.0,
            clips: [],
            aspectRatio: "16:9"
        };
        this.selectedClipId = null;
        this.snapEnabled = true;
        
        // Media Library items
        this.mediaLibrary = [];
        
        const urlParams = new URLSearchParams(window.location.search);
        this.projectId = urlParams.get("project");
        
        this.initDOM();
        this.initEventListeners();
        
        if (this.projectId) {
            this.loadProject();
        } else {
            this.showDashboard();
        }
    }

    initDOM() {
        this.importDropzone = document.getElementById("import-dropzone");
        this.fileInput = document.getElementById("file-input");
        this.mediaList = document.getElementById("media-list");
        this.inspectorContent = document.getElementById("inspector-content");
        
        this.btnPlay = document.getElementById("btn-play-pause");
        this.btnPrev = document.getElementById("btn-prev-frame");
        this.btnNext = document.getElementById("btn-next-frame");
        this.btnSplit = document.getElementById("btn-split");
        this.btnDelete = document.getElementById("btn-delete");
        this.btnSnap = document.getElementById("btn-snap");
        this.btnAddText = document.getElementById("btn-add-text");
        
        this.btnRender = document.getElementById("btn-render");
        this.renderModal = document.getElementById("render-modal");
        this.progressFill = document.getElementById("render-progress-fill");
        this.statusText = document.getElementById("render-status-text");
        this.btnCloseModal = document.getElementById("btn-close-modal");
        this.btnDownload = document.getElementById("btn-download-render");
        this.modalFooter = document.getElementById("modal-footer-actions");
        this.aspectRatioSelect = document.getElementById("aspect-ratio-select");
    }

    initEventListeners() {
        // Drag and drop import files
        this.importDropzone.addEventListener("click", () => this.fileInput.click());
        this.fileInput.addEventListener("change", (e) => this.handleFileSelection(e.target.files));
        
        this.importDropzone.addEventListener("dragover", (e) => {
            e.preventDefault();
            this.importDropzone.classList.add("dragover");
        });
        
        this.importDropzone.addEventListener("dragleave", () => {
            this.importDropzone.classList.remove("dragover");
        });
        
        this.importDropzone.addEventListener("drop", (e) => {
            e.preventDefault();
            this.importDropzone.classList.remove("dragover");
            this.handleFileSelection(e.dataTransfer.files);
        });

        // Transport buttons
        this.btnPlay.addEventListener("click", () => {
            if (window.previewManager.isPlaying) {
                window.previewManager.pause();
            } else {
                window.previewManager.play();
            }
        });

        // Aspect Ratio Selector
        if (this.aspectRatioSelect) {
            this.aspectRatioSelect.addEventListener("change", (e) => {
                this.timeline.aspectRatio = e.target.value;
                window.previewManager.updateAspectRatio(e.target.value);
            });
        }
        
        // Keyboard Shortcuts
        window.addEventListener("keydown", (e) => {
            if (e.code === "Space" && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") {
                e.preventDefault();
                this.btnPlay.click();
            }
            if (e.code === "Delete" || e.code === "Backspace") {
                if (this.selectedClipId && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") {
                    this.deleteSelectedClip();
                }
            }
        });

        // Webpage Zoom with Ctrl + Scroll Wheel
        let pageZoom = 1.0;
        window.addEventListener("wheel", (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
                if (e.deltaY < 0) {
                    pageZoom = Math.min(2.0, pageZoom + 0.05);
                } else {
                    pageZoom = Math.max(0.5, pageZoom - 0.05);
                }
                document.body.style.zoom = pageZoom;
            }
        }, { passive: false });

        this.btnPrev.addEventListener("click", () => {
            window.previewManager.pause();
            window.previewManager.seek(window.previewManager.currentTime - (1 / 30));
        });

        this.btnNext.addEventListener("click", () => {
            window.previewManager.pause();
            window.previewManager.seek(window.previewManager.currentTime + (1 / 30));
        });

        this.btnSplit.addEventListener("click", () => this.splitSelectedClip());
        this.btnDelete.addEventListener("click", () => this.deleteSelectedClip());
        this.btnSnap.addEventListener("click", () => {
            this.snapEnabled = !this.snapEnabled;
            if (this.snapEnabled) {
                this.btnSnap.classList.add("active");
            } else {
                this.btnSnap.classList.remove("active");
            }
        });
        this.btnAddText.addEventListener("click", () => this.addTextOverlay());
        
        // Add Track Listener
        const btnAddTrack = document.getElementById("btn-add-track");
        const addTrackDropdown = document.getElementById("add-track-dropdown");
        if (btnAddTrack && addTrackDropdown) {
            btnAddTrack.addEventListener("click", (e) => {
                e.stopPropagation();
                addTrackDropdown.classList.toggle("hidden");
            });
            addTrackDropdown.querySelectorAll("button[data-track-type]").forEach(btn => {
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const type = btn.dataset.trackType;
                    this.addTrack(type);
                    addTrackDropdown.classList.add("hidden");
                });
            });
            window.addEventListener("click", (e) => {
                if (!btnAddTrack.contains(e.target) && !addTrackDropdown.contains(e.target)) {
                    addTrackDropdown.classList.add("hidden");
                }
            });
        }
        
        // Render
        this.btnRender.addEventListener("click", () => this.renderVideo());
        this.btnCloseModal.addEventListener("click", () => {
            this.renderModal.classList.remove("active");
        });

        // Sidebar panel toggling
        const sidebarButtons = document.querySelectorAll(".sidebar-btn[data-panel]");
        sidebarButtons.forEach(btn => {
            btn.addEventListener("click", () => {
                const panelId = `panel-${btn.dataset.panel}`;
                const panel = document.getElementById(panelId);
                if (panel) {
                    const isVisible = !panel.classList.contains("hidden");
                    if (isVisible) {
                        panel.classList.add("hidden");
                        btn.classList.remove("active");
                    } else {
                        panel.classList.remove("hidden");
                        btn.classList.add("active");
                    }
                }
            });
        });

        // Project creation dashboard binding
        const formCreate = document.getElementById("form-create-project");
        if (formCreate) {
            formCreate.addEventListener("submit", async (e) => {
                e.preventDefault();
                const nameInput = document.getElementById("project-name");
                const aspectSelect = document.getElementById("project-aspect");
                if (!nameInput) return;
                
                const name = nameInput.value;
                const aspectRatio = aspectSelect ? aspectSelect.value : "16:9";
                
                try {
                    const response = await fetch("/api/projects/create", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name, aspectRatio })
                    });
                    const resData = await response.json();
                    if (resData.status === "success") {
                        window.location.search = `?project=${resData.project_id}`;
                    }
                } catch (err) {
                    console.error("Failed to create project:", err);
                }
            });
        }

        // Close/Exit Project
        const btnCloseProject = document.getElementById("btn-close-project");
        if (btnCloseProject) {
            btnCloseProject.addEventListener("click", () => {
                window.location.search = "";
            });
        }
    }

    async handleFileSelection(files) {
        if (files.length === 0) return;
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const formData = new FormData();
            formData.append("file", file);
            
            // Show loading placeholder
            this.addMediaPlaceholder(file.name);
            
            try {
                const response = await fetch(`/projects/${this.projectId}/upload`, {
                    method: "POST",
                    body: formData
                });
                
                const data = await response.json();
                if (data.status === "success") {
                    this.removeMediaPlaceholder(file.name);
                    this.addMediaToLibrary(data);
                } else {
                    alert(`Upload failed for ${file.name}: ${data.message}`);
                    this.removeMediaPlaceholder(file.name);
                }
            } catch (err) {
                console.error("Error uploading file:", err);
                alert(`Error uploading ${file.name}`);
                this.removeMediaPlaceholder(file.name);
            }
        }
    }

    addMediaPlaceholder(name) {
        let empty = this.mediaList.querySelector(".empty-state");
        if (empty) empty.remove();
        
        const loader = document.createElement("div");
        loader.className = "media-item loading-placeholder";
        loader.id = `loader-${name.replace(/[^a-zA-Z0-9]/g, '_')}`;
        loader.innerHTML = `
            <div class="media-thumbnail"><i class="fa-solid fa-spinner fa-spin"></i></div>
            <div class="media-info">
                <div class="media-name">${name}</div>
                <div class="media-meta">Uploading & inspecting...</div>
            </div>
        `;
        this.mediaList.appendChild(loader);
    }

    removeMediaPlaceholder(name) {
        const loader = document.getElementById(`loader-${name.replace(/[^a-zA-Z0-9]/g, '_')}`);
        if (loader) loader.remove();
        if (this.mediaList.children.length === 0) {
            this.showEmptyMediaState();
        }
    }

    showEmptyMediaState() {
        this.mediaList.innerHTML = `
            <div class="empty-state">
                <i class="fa-regular fa-folder-open"></i>
                <p>No media imported yet</p>
            </div>
        `;
    }

    addMediaToLibrary(item) {
        this.mediaLibrary.push(item);
        
        let empty = this.mediaList.querySelector(".empty-state");
        if (empty) empty.remove();
        
        const itemEl = document.createElement("div");
        itemEl.className = "media-item";
        itemEl.draggable = true;
        
        let typeIcon = "fa-file";
        let typeClass = "video";
        let thumbnail = "";
        
        const isImage = item.metadata.is_image;
        const hasVideo = item.metadata.has_video;
        const hasAudio = item.metadata.has_audio;
        
        if (isImage) {
            typeIcon = "fa-image";
            typeClass = "image";
            thumbnail = `<img src="${item.url}">`;
        } else if (hasVideo) {
            typeIcon = "fa-video";
            typeClass = "video";
            thumbnail = `<i class="fa-solid fa-video"></i>`;
        } else if (hasAudio) {
            typeIcon = "fa-volume-high";
            typeClass = "audio";
            thumbnail = `<i class="fa-solid fa-volume-high"></i>`;
        }
        
        itemEl.innerHTML = `
            <div class="media-thumbnail ${typeClass}">${thumbnail}</div>
            <div class="media-info">
                <div class="media-name">${item.name}</div>
                <div class="media-meta">${isImage ? 'Image' : this.formatSeconds(item.metadata.duration)}</div>
            </div>
            <button class="media-action-add" title="Add to timeline"><i class="fa-solid fa-plus"></i></button>
        `;
        
        // Click to add to timeline
        itemEl.querySelector(".media-action-add").addEventListener("click", () => {
            this.addMediaToTimeline(item);
        });
        
        // Drag start to timeline
        itemEl.addEventListener("dragstart", (e) => {
            e.dataTransfer.setData("application/json", JSON.stringify(item));
        });
        
        this.mediaList.appendChild(itemEl);
    }

    addMediaToTimeline(mediaItem) {
        const start = window.previewManager.currentTime;
        const isImage = mediaItem.metadata.is_image;
        const duration = isImage ? 5.0 : mediaItem.metadata.duration;
        
        let type = "video";
        if (isImage) {
            type = "image";
        } else if (!mediaItem.metadata.has_video && mediaItem.metadata.has_audio) {
            type = "audio";
        }

        const targetTrack = this.timeline.tracks.find(t => t.type === type) || { id: `${type}-1` };
        
        const clip = {
            id: `clip_${Math.random().toString(36).substr(2, 9)}`,
            type: type,
            name: mediaItem.name,
            filepath: mediaItem.filepath,
            url: mediaItem.url,
            trackId: targetTrack.id,
            start: start,
            end: start + duration,
            clipStart: 0.0,
            clipEnd: duration,
            sourceDuration: isImage ? 9999.0 : mediaItem.metadata.duration,
            volume: 1.0,
            speed: 1.0,
            effects: {
                grayscale: false,
                sepia: false,
                brightness: 1.0,
                contrast: 1.0
            },
            transitions: {
                fadeIn: 0.0,
                fadeOut: 0.0
            }
        };

        if (type === "video" || type === "image") {
            const ratio = this.timeline.aspectRatio || "16:9";
            let outW = 1280, outH = 720;
            if (ratio === "9:16") { outW = 720; outH = 1280; }
            else if (ratio === "1:1") { outW = 720; outH = 720; }
            else if (ratio === "4:3") { outW = 960; outH = 720; }
            
            const mediaW = mediaItem.metadata.width || outW;
            const mediaH = mediaItem.metadata.height || outH;
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
            clip.metadata = mediaItem.metadata;
        }
        
        this.timeline.clips.push(clip);
        this.selectedClipId = clip.id;
        
        this.saveTimelineState(`Add clip: ${clip.name}`);
    }

    addTextOverlay() {
        const start = window.previewManager.currentTime;
        const targetTrack = this.timeline.tracks.find(t => t.type === "text") || { id: "text-1" };
        
        const clip = {
            id: `clip_${Math.random().toString(36).substr(2, 9)}`,
            type: "text",
            text: "Text Overlay",
            trackId: targetTrack.id,
            start: start,
            end: start + 4.0,
            fontSize: 48,
            color: "#ffffff",
            position: "center",
            fadeIn: 0.5,
            fadeOut: 0.5
        };
        
        this.timeline.clips.push(clip);
        this.selectedClipId = clip.id;
        
        this.saveTimelineState("Add text overlay");
    }

    addTrack(type) {
        let icon = "fa-video";
        if (type === "image") icon = "fa-image";
        else if (type === "audio") icon = "fa-volume-high";
        else if (type === "text") icon = "fa-t";

        const tracksOfType = this.timeline.tracks.filter(t => t.type === type);
        const nextNum = tracksOfType.length + 1;
        const newTrackId = `${type}-${nextNum}-${Math.random().toString(36).substr(2, 4)}`;

        this.timeline.tracks.push({
            id: newTrackId,
            type: type,
            icon: icon
        });

        this.saveTimelineState(`Add ${type} track`);
        window.timelineManager.render();
    }

    deleteTrack(trackId) {
        const trackToDelete = this.timeline.tracks.find(t => t.id === trackId);
        if (!trackToDelete) return;

        const tracksOfType = this.timeline.tracks.filter(t => t.type === trackToDelete.type);
        if (tracksOfType.length <= 1) {
            alert(`Cannot delete the last remaining ${trackToDelete.type} track.`);
            return;
        }

        if (!confirm(`Are you sure you want to delete this track? All clips on this track will be moved to the remaining ${trackToDelete.type} track.`)) {
            return;
        }

        const remainingTrack = tracksOfType.find(t => t.id !== trackId);
        this.timeline.clips.forEach(clip => {
            if (clip.trackId === trackId) {
                clip.trackId = remainingTrack.id;
            }
        });

        this.timeline.tracks = this.timeline.tracks.filter(t => t.id !== trackId);

        this.saveTimelineState(`Delete track: ${trackId}`);
        window.timelineManager.render();
    }

    deleteSelectedClip() {
        if (!this.selectedClipId) return;
        
        this.timeline.clips = this.timeline.clips.filter(c => c.id !== this.selectedClipId);
        this.selectedClipId = null;
        
        this.saveTimelineState("Delete clip");
    }

    splitSelectedClip() {
        if (!this.selectedClipId) return;
        
        const splitTime = window.previewManager.currentTime;
        const clipIndex = this.timeline.clips.findIndex(c => c.id === this.selectedClipId);
        if (clipIndex === -1) return;
        
        const clip = this.timeline.clips[clipIndex];
        
        // Splitting text overlays is simple, media is speed adjusted
        if (splitTime > clip.start && splitTime < clip.end) {
            const firstHalfDuration = splitTime - clip.start;
            
            // Clone clip
            const clip2 = JSON.parse(JSON.stringify(clip));
            clip2.id = `clip_${Math.random().toString(36).substr(2, 9)}`;
            
            // Adjust Clip 1 (original)
            clip.end = splitTime;
            if (clip.type !== "text" && clip.type !== "image") {
                const speed = clip.speed || 1.0;
                clip.clipEnd = (clip.clipStart || 0) + (firstHalfDuration * speed);
            }
            
            // Adjust Clip 2 (new half)
            clip2.start = splitTime;
            if (clip2.type !== "text" && clip2.type !== "image") {
                const speed = clip.speed || 1.0;
                clip2.clipStart = (clip.clipStart || 0) + (firstHalfDuration * speed);
            }
            
            this.timeline.clips.splice(clipIndex + 1, 0, clip2);
            this.selectedClipId = clip2.id;
            
            this.saveTimelineState("Split clip");
        }
    }

    selectClip(clipId) {
        this.selectedClipId = clipId;
        this.renderInspector();
        window.timelineManager.render();
        if (window.previewManager) {
            window.previewManager.updatePreviewState();
        }
    }

    async saveTimelineState(actionDescription = "Modify timeline") {
        // Calculate and sync total timeline duration
        let maxEndTime = 10.0;
        this.timeline.clips.forEach(clip => {
            if (clip.end > maxEndTime) maxEndTime = clip.end;
        });
        
        this.timeline.duration = maxEndTime;
        
        // Sync structures to managers
        window.previewManager.setClips(this.timeline.clips);
        window.previewManager.setTotalDuration(maxEndTime);
        window.timelineManager.render();
        
        this.renderInspector();

        if (!this.projectId) return;

        try {
            await fetch(`/api/projects/${this.projectId}/save`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    timeline: this.timeline,
                    actionDescription: actionDescription
                })
            });
        } catch (e) {
            console.error("Auto-save failed:", e);
        }
    }

    renderInspector() {
        if (!this.selectedClipId) {
            this.inspectorContent.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-arrow-pointer"></i>
                    <p>Select a clip in the timeline to edit properties</p>
                </div>
            `;
            return;
        }
        
        const clip = this.timeline.clips.find(c => c.id === this.selectedClipId);
        if (!clip) return;
        
        let html = "";
        
        if (clip.type === "video" || clip.type === "image") {
            const hasAudio = clip.type === "video";
            
            html = `
                <div class="inspector-group">
                    <h4>Media Specifications</h4>
                    <div class="property-control">
                        <label>Clip Name</label>
                        <input type="text" value="${clip.name}" readonly>
                    </div>
                    <div class="property-control">
                        <label>Start On Timeline (s)</label>
                        <input type="text" id="prop-start" value="${clip.start.toFixed(2)}">
                    </div>
                    <div class="property-control">
                        <label>Duration On Timeline (s)</label>
                        <input type="text" id="prop-duration" value="${(clip.end - clip.start).toFixed(2)}">
                    </div>
                </div>

                <div class="inspector-group">
                    <h4>Transformations</h4>
                    <div class="flex gap-2 mb-2">
                        <div class="property-control flex-1">
                            <label>X Pos</label>
                            <input type="number" id="prop-x" value="${clip.x !== undefined ? clip.x : 0}">
                        </div>
                        <div class="property-control flex-1">
                            <label>Y Pos</label>
                            <input type="number" id="prop-y" value="${clip.y !== undefined ? clip.y : 0}">
                        </div>
                    </div>
                    <div class="flex gap-2 mb-2">
                        <div class="property-control flex-1">
                            <label>Width</label>
                            <input type="number" id="prop-w" value="${clip.width !== undefined ? clip.width : 1280}">
                        </div>
                        <div class="property-control flex-1">
                            <label>Height</label>
                            <input type="number" id="prop-h" value="${clip.height !== undefined ? clip.height : 720}">
                        </div>
                    </div>
                    <div class="property-control">
                        <label>Rotation</label>
                        <div class="property-value">
                            <input type="range" id="prop-rot" min="0" max="360" step="1" value="${clip.rotation || 0}">
                            <span id="val-rot">${clip.rotation || 0}°</span>
                        </div>
                    </div>
                </div>
                
                ${hasAudio ? `
                <div class="inspector-group">
                    <h4>Audio Adjustments</h4>
                    <div class="property-control">
                        <label>Volume</label>
                        <div class="property-value">
                            <input type="range" id="prop-volume" min="0" max="2" step="0.1" value="${clip.volume || 1.0}">
                            <span id="val-volume">${(clip.volume || 1.0).toFixed(1)}</span>
                        </div>
                    </div>
                </div>
                ` : ''}

                <div class="inspector-group">
                    <h4>Speed & Fades</h4>
                    ${clip.type === "video" ? `
                    <div class="property-control">
                        <label>Playback Speed</label>
                        <div class="property-value">
                            <input type="range" id="prop-speed" min="0.5" max="2.0" step="0.1" value="${clip.speed || 1.0}">
                            <span id="val-speed">${(clip.speed || 1.0).toFixed(1)}x</span>
                        </div>
                    </div>
                    ` : ''}
                    <div class="property-control">
                        <label>Fade In Duration (s)</label>
                        <div class="property-value">
                            <input type="range" id="prop-fadein" min="0" max="5" step="0.1" value="${clip.transitions?.fadeIn || 0.0}">
                            <span id="val-fadein">${(clip.transitions?.fadeIn || 0.0).toFixed(1)}s</span>
                        </div>
                    </div>
                    <div class="property-control">
                        <label>Fade Out Duration (s)</label>
                        <div class="property-value">
                            <input type="range" id="prop-fadeout" min="0" max="5" step="0.1" value="${clip.transitions?.fadeOut || 0.0}">
                            <span id="val-fadeout">${(clip.transitions?.fadeOut || 0.0).toFixed(1)}s</span>
                        </div>
                    </div>
                </div>

                <div class="inspector-group">
                    <h4>Color Effects</h4>
                    <div class="property-control">
                        <label class="checkbox-label">
                            <input type="checkbox" id="prop-grayscale" ${clip.effects?.grayscale ? 'checked' : ''}>
                            Grayscale Filter
                        </label>
                    </div>
                    <div class="property-control">
                        <label class="checkbox-label">
                            <input type="checkbox" id="prop-sepia" ${clip.effects?.sepia ? 'checked' : ''}>
                            Sepia Filter
                        </label>
                    </div>
                    <div class="property-control">
                        <label>Brightness</label>
                        <div class="property-value">
                            <input type="range" id="prop-brightness" min="0.5" max="2.0" step="0.1" value="${clip.effects?.brightness || 1.0}">
                            <span id="val-brightness">${(clip.effects?.brightness || 1.0).toFixed(1)}</span>
                        </div>
                    </div>
                    <div class="property-control">
                        <label>Contrast</label>
                        <div class="property-value">
                            <input type="range" id="prop-contrast" min="0.5" max="2.0" step="0.1" value="${clip.effects?.contrast || 1.0}">
                            <span id="val-contrast">${(clip.effects?.contrast || 1.0).toFixed(1)}</span>
                        </div>
                    </div>
                </div>
            `;
        } else if (clip.type === "audio") {
            html = `
                <div class="inspector-group">
                    <h4>Audio Specifications</h4>
                    <div class="property-control">
                        <label>Audio Name</label>
                        <input type="text" value="${clip.name}" readonly>
                    </div>
                    <div class="property-control">
                        <label>Start On Timeline (s)</label>
                        <input type="text" id="prop-start" value="${clip.start.toFixed(2)}">
                    </div>
                    <div class="property-control">
                        <label>Duration On Timeline (s)</label>
                        <input type="text" id="prop-duration" value="${(clip.end - clip.start).toFixed(2)}">
                    </div>
                </div>
                
                <div class="inspector-group">
                    <h4>Audio Adjustments</h4>
                    <div class="property-control">
                        <label>Volume</label>
                        <div class="property-value">
                            <input type="range" id="prop-volume" min="0" max="2" step="0.1" value="${clip.volume || 1.0}">
                            <span id="val-volume">${(clip.volume || 1.0).toFixed(1)}</span>
                        </div>
                    </div>
                    <div class="property-control">
                        <label>Playback Speed</label>
                        <div class="property-value">
                            <input type="range" id="prop-speed" min="0.5" max="2.0" step="0.1" value="${clip.speed || 1.0}">
                            <span id="val-speed">${(clip.speed || 1.0).toFixed(1)}x</span>
                        </div>
                    </div>
                </div>

                <div class="inspector-group">
                    <h4>Fades</h4>
                    <div class="property-control">
                        <label>Fade In Duration (s)</label>
                        <div class="property-value">
                            <input type="range" id="prop-fadein" min="0" max="5" step="0.1" value="${clip.transitions?.fadeIn || 0.0}">
                            <span id="val-fadein">${(clip.transitions?.fadeIn || 0.0).toFixed(1)}s</span>
                        </div>
                    </div>
                    <div class="property-control">
                        <label>Fade Out Duration (s)</label>
                        <div class="property-value">
                            <input type="range" id="prop-fadeout" min="0" max="5" step="0.1" value="${clip.transitions?.fadeOut || 0.0}">
                            <span id="val-fadeout">${(clip.transitions?.fadeOut || 0.0).toFixed(1)}s</span>
                        </div>
                    </div>
                </div>
            `;
        } else if (clip.type === "text") {
            html = `
                <div class="inspector-group">
                    <h4>Text Overlay Specifications</h4>
                    <div class="property-control">
                        <label>Text Content</label>
                        <input type="text" id="prop-text-val" value="${clip.text}">
                    </div>
                    <div class="property-control">
                        <label>Start On Timeline (s)</label>
                        <input type="text" id="prop-start" value="${clip.start.toFixed(2)}">
                    </div>
                    <div class="property-control">
                        <label>Duration On Timeline (s)</label>
                        <input type="text" id="prop-duration" value="${(clip.end - clip.start).toFixed(2)}">
                    </div>
                </div>

                <div class="inspector-group">
                    <h4>Styling</h4>
                    <div class="property-control">
                        <label>Font Size (px)</label>
                        <div class="property-value">
                            <input type="range" id="prop-fontsize" min="12" max="120" step="2" value="${clip.fontSize || 48}">
                            <span id="val-fontsize">${clip.fontSize || 48}px</span>
                        </div>
                    </div>
                    <div class="property-control">
                        <label>Font Color</label>
                        <input type="color" id="prop-color" value="${clip.color || '#ffffff'}">
                    </div>
                    <div class="property-control">
                        <label>Position</label>
                        <select id="prop-position">
                            <option value="top" ${clip.position === 'top' ? 'selected' : ''}>Top</option>
                            <option value="center" ${clip.position === 'center' ? 'selected' : ''}>Center</option>
                            <option value="bottom" ${clip.position === 'bottom' ? 'selected' : ''}>Bottom</option>
                        </select>
                    </div>
                </div>

                <div class="inspector-group">
                    <h4>Fades</h4>
                    <div class="property-control">
                        <label>Fade In Duration (s)</label>
                        <div class="property-value">
                            <input type="range" id="prop-fadein-txt" min="0" max="5" step="0.1" value="${clip.fadeIn || 0.0}">
                            <span id="val-fadein-txt">${(clip.fadeIn || 0.0).toFixed(1)}s</span>
                        </div>
                    </div>
                    <div class="property-control">
                        <label>Fade Out Duration (s)</label>
                        <div class="property-value">
                            <input type="range" id="prop-fadeout-txt" min="0" max="5" step="0.1" value="${clip.fadeOut || 0.0}">
                            <span id="val-fadeout-txt">${(clip.fadeOut || 0.0).toFixed(1)}s</span>
                        </div>
                    </div>
                </div>
            `;
        }
        
        this.inspectorContent.innerHTML = html;
        this.bindInspectorEvents(clip);
    }

    bindInspectorEvents(clip) {
        // Timeline start and duration fields (manual enter)
        const startInput = document.getElementById("prop-start");
        const durInput = document.getElementById("prop-duration");
        
        if (startInput) {
            startInput.addEventListener("change", (e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val) && val >= 0) {
                    const dur = clip.end - clip.start;
                    clip.start = val;
                    clip.end = val + dur;
                    this.saveTimelineState("Move clip start");
                }
            });
        }
        
        if (durInput) {
            durInput.addEventListener("change", (e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val) && val > 0.1) {
                    const maxEnd = clip.start + (clip.sourceDuration || 9999);
                    clip.end = Math.min(clip.start + val, maxEnd);
                    if (clip.type !== "text" && clip.type !== "image") {
                        clip.clipEnd = clip.clipStart + (clip.end - clip.start) * (clip.speed || 1.0);
                    }
                    this.saveTimelineState("Change clip duration");
                }
            });
        }

        // Transform inputs (X, Y, W, H, Rotation)
        const xInput = document.getElementById("prop-x");
        const yInput = document.getElementById("prop-y");
        const wInput = document.getElementById("prop-w");
        const hInput = document.getElementById("prop-h");
        const rotInput = document.getElementById("prop-rot");

        if (xInput) {
            xInput.addEventListener("change", (e) => {
                const val = parseInt(e.target.value);
                if (!isNaN(val)) {
                    clip.x = val;
                    window.previewManager.updatePreviewState();
                    this.saveTimelineState("Change clip X position");
                }
            });
        }
        if (yInput) {
            yInput.addEventListener("change", (e) => {
                const val = parseInt(e.target.value);
                if (!isNaN(val)) {
                    clip.y = val;
                    window.previewManager.updatePreviewState();
                    this.saveTimelineState("Change clip Y position");
                }
            });
        }
        if (wInput) {
            wInput.addEventListener("change", (e) => {
                const val = parseInt(e.target.value);
                if (!isNaN(val) && val > 10) {
                    clip.width = val;
                    window.previewManager.updatePreviewState();
                    this.saveTimelineState("Resize clip width");
                }
            });
        }
        if (hInput) {
            hInput.addEventListener("change", (e) => {
                const val = parseInt(e.target.value);
                if (!isNaN(val) && val > 10) {
                    clip.height = val;
                    window.previewManager.updatePreviewState();
                    this.saveTimelineState("Resize clip height");
                }
            });
        }
        if (rotInput) {
            rotInput.addEventListener("input", (e) => {
                const val = parseInt(e.target.value);
                clip.rotation = val;
                const rotVal = document.getElementById("val-rot");
                if (rotVal) rotVal.textContent = `${val}°`;
                window.previewManager.updatePreviewState();
            });
            rotInput.addEventListener("change", (e) => {
                this.saveTimelineState("Rotate clip");
            });
        }
        
        // Range slider text/visual updates (bind input event for real-time responsiveness)
        const volumeSlider = document.getElementById("prop-volume");
        if (volumeSlider) {
            volumeSlider.addEventListener("input", (e) => {
                const val = parseFloat(e.target.value);
                document.getElementById("val-volume").textContent = val.toFixed(1);
                clip.volume = val;
                window.previewManager.updatePreviewState();
            });
            volumeSlider.addEventListener("change", () => {
                this.saveTimelineState("Change clip volume");
            });
        }
        
        const speedSlider = document.getElementById("prop-speed");
        if (speedSlider) {
            speedSlider.addEventListener("input", (e) => {
                const val = parseFloat(e.target.value);
                document.getElementById("val-speed").textContent = val.toFixed(1) + "x";
                
                // Adjust clip duration based on speed change to maintain clip boundaries
                const oldSpeed = clip.speed || 1.0;
                clip.speed = val;
                
                // Keep source frame boundaries, adjust timeline end
                const dur = (clip.clipEnd - clip.clipStart) / val;
                clip.end = clip.start + dur;
                
                document.getElementById("prop-duration").value = dur.toFixed(2);
            });
            speedSlider.addEventListener("change", () => {
                this.saveTimelineState("Change clip playback speed");
            });
        }
        
        // Fades
        const fadeinSlider = document.getElementById("prop-fadein");
        if (fadeinSlider) {
            fadeinSlider.addEventListener("input", (e) => {
                const val = parseFloat(e.target.value);
                document.getElementById("val-fadein").textContent = val.toFixed(1) + "s";
                if (!clip.transitions) clip.transitions = {};
                clip.transitions.fadeIn = val;
                window.previewManager.updatePreviewState();
            });
            fadeinSlider.addEventListener("change", () => {
                this.saveTimelineState("Change clip fade in");
            });
        }
        
        const fadeoutSlider = document.getElementById("prop-fadeout");
        if (fadeoutSlider) {
            fadeoutSlider.addEventListener("input", (e) => {
                const val = parseFloat(e.target.value);
                document.getElementById("val-fadeout").textContent = val.toFixed(1) + "s";
                if (!clip.transitions) clip.transitions = {};
                clip.transitions.fadeOut = val;
                window.previewManager.updatePreviewState();
            });
            fadeoutSlider.addEventListener("change", () => {
                this.saveTimelineState("Change clip fade out");
            });
        }
        
        // Color Filters
        const grayCheck = document.getElementById("prop-grayscale");
        if (grayCheck) {
            grayCheck.addEventListener("change", (e) => {
                if (!clip.effects) clip.effects = {};
                clip.effects.grayscale = e.target.checked;
                if (e.target.checked) {
                    const sepiaCheck = document.getElementById("prop-sepia");
                    if (sepiaCheck) {
                        sepiaCheck.checked = false;
                        clip.effects.sepia = false;
                    }
                }
                window.previewManager.updatePreviewState();
                this.saveTimelineState("Toggle clip grayscale");
            });
        }
        
        const sepiaCheck = document.getElementById("prop-sepia");
        if (sepiaCheck) {
            sepiaCheck.addEventListener("change", (e) => {
                if (!clip.effects) clip.effects = {};
                clip.effects.sepia = e.target.checked;
                if (e.target.checked) {
                    const grayCheck = document.getElementById("prop-grayscale");
                    if (grayCheck) {
                        grayCheck.checked = false;
                        clip.effects.grayscale = false;
                    }
                }
                window.previewManager.updatePreviewState();
                this.saveTimelineState("Toggle clip sepia");
            });
        }
        
        const brightnessSlider = document.getElementById("prop-brightness");
        if (brightnessSlider) {
            brightnessSlider.addEventListener("input", (e) => {
                const val = parseFloat(e.target.value);
                document.getElementById("val-brightness").textContent = val.toFixed(1);
                if (!clip.effects) clip.effects = {};
                clip.effects.brightness = val;
                window.previewManager.updatePreviewState();
            });
            brightnessSlider.addEventListener("change", () => {
                this.saveTimelineState("Change clip brightness");
            });
        }
        
        const contrastSlider = document.getElementById("prop-contrast");
        if (contrastSlider) {
            contrastSlider.addEventListener("input", (e) => {
                const val = parseFloat(e.target.value);
                document.getElementById("val-contrast").textContent = val.toFixed(1);
                if (!clip.effects) clip.effects = {};
                clip.effects.contrast = val;
                window.previewManager.updatePreviewState();
            });
            contrastSlider.addEventListener("change", () => {
                this.saveTimelineState("Change clip contrast");
            });
        }
        
        // Text specific fields
        const textVal = document.getElementById("prop-text-val");
        if (textVal) {
            textVal.addEventListener("input", (e) => {
                clip.text = e.target.value;
                window.previewManager.updatePreviewState();
            });
            textVal.addEventListener("change", (e) => {
                this.saveTimelineState("Edit text overlay content");
            });
        }
        
        const fontSizeSlider = document.getElementById("prop-fontsize");
        if (fontSizeSlider) {
            fontSizeSlider.addEventListener("input", (e) => {
                const val = parseInt(e.target.value);
                document.getElementById("val-fontsize").textContent = val + "px";
                clip.fontSize = val;
                window.previewManager.updatePreviewState();
            });
            fontSizeSlider.addEventListener("change", () => {
                this.saveTimelineState("Change text font size");
            });
        }
        
        const colorInput = document.getElementById("prop-color");
        if (colorInput) {
            colorInput.addEventListener("input", (e) => {
                clip.color = e.target.value;
                window.previewManager.updatePreviewState();
            });
            colorInput.addEventListener("change", () => {
                this.saveTimelineState("Change text color");
            });
        }
        
        const positionSelect = document.getElementById("prop-position");
        if (positionSelect) {
            positionSelect.addEventListener("change", (e) => {
                clip.position = e.target.value;
                window.previewManager.updatePreviewState();
                this.saveTimelineState("Change text position");
            });
        }
        
        const fadeinTxtSlider = document.getElementById("prop-fadein-txt");
        if (fadeinTxtSlider) {
            fadeinTxtSlider.addEventListener("input", (e) => {
                const val = parseFloat(e.target.value);
                document.getElementById("val-fadein-txt").textContent = val.toFixed(1) + "s";
                clip.fadeIn = val;
                window.previewManager.updatePreviewState();
            });
            fadeinTxtSlider.addEventListener("change", () => {
                this.saveTimelineState("Change text fade in duration");
            });
        }
        
        const fadeoutTxtSlider = document.getElementById("prop-fadeout-txt");
        if (fadeoutTxtSlider) {
            fadeoutTxtSlider.addEventListener("input", (e) => {
                const val = parseFloat(e.target.value);
                document.getElementById("val-fadeout-txt").textContent = val.toFixed(1) + "s";
                clip.fadeOut = val;
                window.previewManager.updatePreviewState();
            });
            fadeoutTxtSlider.addEventListener("change", () => {
                this.saveTimelineState("Change text fade out duration");
            });
        }
    }

    async renderVideo() {
        if (this.timeline.clips.length === 0) {
            alert("Timeline is empty! Import media and add clips to the timeline before rendering.");
            return;
        }
        
        // Show rendering progress modal
        this.renderModal.classList.add("active");
        this.progressFill.style.width = "0%";
        this.progressFill.textContent = "0%";
        this.statusText.textContent = "Compiling timeline JSON & media streams...";
        this.btnCloseModal.disabled = true;
        this.btnDownload.style.display = "none";
        
        try {
            const response = await fetch(`/projects/${this.projectId}/render`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(this.timeline)
            });
            
            const data = await response.json();
            if (data.status === "success") {
                this.pollRenderProgress(data.render_id);
            } else {
                this.showRenderError(data.message);
            }
        } catch (err) {
            console.error("Render submission error:", err);
            this.showRenderError("Could not submit rendering request.");
        }
    }

    pollRenderProgress(renderId) {
        const interval = setInterval(async () => {
            try {
                const response = await fetch(`/projects/${this.projectId}/render-status/${renderId}`);
                const data = await response.json();
                
                if (data.status === "rendering") {
                    const percent = data.progress;
                    this.progressFill.style.width = `${percent}%`;
                    this.progressFill.textContent = `${percent}%`;
                    this.statusText.textContent = `Processing frames... (${percent}%)`;
                } else if (data.status === "completed") {
                    clearInterval(interval);
                    this.progressFill.style.width = "100%";
                    this.progressFill.textContent = "100%";
                    this.statusText.innerHTML = `<span style="color: var(--color-audio); font-weight: 600;"><i class="fa-solid fa-circle-check"></i> Render completed successfully!</span>`;
                    
                    // Show download action
                    this.btnDownload.href = data.output_url;
                    this.btnDownload.style.display = "inline-flex";
                    this.btnCloseModal.disabled = false;
                } else if (data.status === "failed") {
                    clearInterval(interval);
                    this.showRenderError("FFmpeg process exited with an error. Please verify input files and settings.");
                }
            } catch (err) {
                console.error("Error polling render status:", err);
            }
        }, 1000);
    }

    showRenderError(msg) {
        this.progressFill.style.width = "100%";
        this.progressFill.style.background = "var(--color-danger)";
        this.progressFill.textContent = "Error";
        this.statusText.innerHTML = `<span style="color: var(--color-danger); font-weight: 500;"><i class="fa-solid fa-triangle-exclamation"></i> Rendering failed: ${msg}</span>`;
        this.btnCloseModal.disabled = false;
    }

    async loadProject() {
        if (!this.projectId) return;
        try {
            const response = await fetch(`/api/projects/${this.projectId}`);
            if (!response.ok) {
                window.location.href = "/";
                return;
            }
            const data = await response.json();
            this.timeline = data;
            
            // Fallback for tracks
            if (!this.timeline.tracks || this.timeline.tracks.length === 0) {
                this.timeline.tracks = [
                    { id: "text-1", type: "text", icon: "fa-t" },
                    { id: "image-1", type: "image", icon: "fa-image" },
                    { id: "video-1", type: "video", icon: "fa-video" },
                    { id: "audio-1", type: "audio", icon: "fa-volume-high" }
                ];
            }
            
            if (this.aspectRatioSelect) {
                this.aspectRatioSelect.value = this.timeline.aspectRatio || "16:9";
            }
            window.previewManager.updateAspectRatio(this.timeline.aspectRatio || "16:9");
            
            this.timeline.clips.forEach(clip => {
                if (clip.url && !clip.url.startsWith("/projects/")) {
                    const filename = clip.url.split("/").pop();
                    clip.url = `/projects/${this.projectId}/uploads/${filename}`;
                }
                if (!clip.metadata && clip.type !== "text") {
                    clip.metadata = {
                        has_video: clip.type === "video",
                        has_audio: clip.type === "audio" || clip.type === "video",
                        is_image: clip.type === "image",
                        width: clip.width,
                        height: clip.height
                    };
                }
                // Track ID fallback
                if (!clip.trackId) {
                    if (clip.type === "video") clip.trackId = "video-1";
                    else if (clip.type === "image") clip.trackId = "image-1";
                    else if (clip.type === "audio") clip.trackId = "audio-1";
                    else if (clip.type === "text") clip.trackId = "text-1";
                }
                // Ensure track exists in tracks list
                const trackExists = this.timeline.tracks.some(t => t.id === clip.trackId);
                if (!trackExists) {
                    let icon = "fa-video";
                    if (clip.type === "image") icon = "fa-image";
                    else if (clip.type === "audio") icon = "fa-volume-high";
                    else if (clip.type === "text") icon = "fa-t";
                    this.timeline.tracks.push({
                        id: clip.trackId,
                        type: clip.type,
                        icon: icon
                    });
                }
            });
            
            const uniqueFiles = new Map();
            this.timeline.clips.forEach(clip => {
                if (clip.type !== "text" && clip.filepath) {
                    uniqueFiles.set(clip.filepath, {
                        name: clip.name,
                        filename: clip.url.split("/").pop(),
                        filepath: clip.filepath,
                        url: clip.url,
                        metadata: clip.metadata || { has_video: clip.type === "video", has_audio: clip.type === "audio" || clip.type === "video", is_image: clip.type === "image" }
                    });
                }
            });
            this.mediaLibrary = Array.from(uniqueFiles.values());
            this.updateMediaLibraryUI();
            
            window.timelineManager.clips = this.timeline.clips;
            window.previewManager.setClips(this.timeline.clips);
            
            let maxDuration = 10.0;
            this.timeline.clips.forEach(clip => {
                if (clip.end > maxDuration) {
                    maxDuration = clip.end;
                }
            });
            this.timeline.duration = maxDuration;
            window.previewManager.setTotalDuration(maxDuration);
            window.timelineManager.setMaxDuration(maxDuration);
            window.timelineManager.render();
            window.previewManager.seek(0.0);
            
            const dashboard = document.getElementById("project-dashboard");
            if (dashboard) {
                dashboard.classList.remove("active");
            }
        } catch (e) {
            console.error("Failed to load project:", e);
            window.location.href = "/";
        }
    }

    async showDashboard() {
        const dashboard = document.getElementById("project-dashboard");
        if (dashboard) {
            dashboard.classList.add("active");
        }
        
        const projectListContainer = document.getElementById("project-list-container");
        const projectCount = document.getElementById("project-count");
        
        try {
            const response = await fetch("/api/projects");
            const projects = await response.json();
            
            if (projectCount) {
                projectCount.textContent = projects.length;
            }
            
            if (projects.length === 0) {
                projectListContainer.innerHTML = `
                    <div class="empty-projects-state">
                        <i class="fa-regular fa-folder-open text-3xl mb-3 text-neutral-600"></i>
                        <p class="text-xs text-neutral-500">No projects found. Create one on the left!</p>
                    </div>`;
                return;
            }
            
            projectListContainer.innerHTML = "";
            projects.forEach(p => {
                const card = document.createElement("div");
                card.className = "project-card";
                card.dataset.id = p.id;
                
                let ratioIcon = "fa-rectangle-list";
                if (p.aspectRatio === "16:9") ratioIcon = "fa-desktop";
                else if (p.aspectRatio === "9:16") ratioIcon = "fa-mobile-screen-button";
                else if (p.aspectRatio === "1:1") ratioIcon = "fa-square";
                
                const escName = p.name.replace(/[&<>'"]/g, t => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[t]||t));
                
                card.innerHTML = `
                    <div class="project-card-info">
                        <div class="project-card-title">${escName}</div>
                        <div class="project-card-meta">
                            <span><i class="fa-solid ${ratioIcon}"></i> ${p.aspectRatio}</span>
                            <span><i class="fa-regular fa-clock"></i> ${this.formatSeconds(p.duration)}</span>
                            <span>Updated: ${p.lastModified}</span>
                        </div>
                    </div>
                    <div class="project-card-action">
                        <i class="fa-solid fa-arrow-right"></i>
                    </div>
                `;
                
                card.addEventListener("click", () => {
                    window.location.search = `?project=${p.id}`;
                });
                
                projectListContainer.appendChild(card);
            });
        } catch (e) {
            console.error("Failed to load project list:", e);
        }
    }

    updateMediaLibraryUI() {
        this.mediaList.innerHTML = "";
        if (this.mediaLibrary.length === 0) {
            this.showEmptyMediaState();
        } else {
            this.mediaLibrary.forEach(item => this.addMediaToLibrary(item));
        }
    }

    formatSeconds(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
}

// Load App
window.addEventListener("DOMContentLoaded", () => {
    window.appState = new AppState();
});
