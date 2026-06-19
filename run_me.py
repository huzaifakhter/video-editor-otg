import os
import sys
import threading
import webview

# Get the root directory of the project
root_dir = os.path.dirname(os.path.abspath(__file__))

# Add root directory and engine directory to sys.path
# This is necessary because Python's embeddable package does not automatically add the script's directory to sys.path
sys.path.insert(0, root_dir)
sys.path.insert(0, os.path.join(root_dir, "engine"))

from engine.video_editor import app

def run_flask():
    app.run(
        host="127.0.0.1",
        port=5000,
        debug=False,
        use_reloader=False
    )

if __name__ == "__main__":
    flask_thread = threading.Thread(target=run_flask, daemon=True)
    flask_thread.start()

    webview.create_window(
        "Video Editor",
        "http://127.0.0.1:5000",
        width=1400,
        height=900
    )

    icon_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "engine", "icon.ico")
    webview.start(icon=icon_path)