import os
import threading
import webview
from video_editor import app

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

    icon_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icon.ico")
    webview.start(icon=icon_path)