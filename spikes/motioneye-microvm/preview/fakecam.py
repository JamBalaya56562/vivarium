import io
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image, ImageDraw

PORT = 9900
COLOURS = {1: (40, 90, 160), 2: (160, 70, 40), 3: (40, 140, 80), 4: (120, 60, 140)}


def frame(camera_id: int) -> bytes:
    image = Image.new("RGB", (640, 480), COLOURS[camera_id])
    draw = ImageDraw.Draw(image)
    now = time.time()
    x = int(now * 80) % 600
    draw.rectangle((x, 200, x + 40, 240), fill=(240, 240, 240))
    draw.text((20, 20), f"fake camera {camera_id}", fill=(255, 255, 255))
    draw.text((20, 40), time.strftime("%H:%M:%S", time.gmtime(now)), fill=(255, 255, 255))
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=80)
    return buffer.getvalue()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        name = self.path.strip("/")
        if not (name.startswith("cam") and name.endswith(".jpg")):
            self.send_error(404)
            return
        try:
            body = frame(int(name[3:-4]))
        except (KeyError, ValueError):
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass


ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
