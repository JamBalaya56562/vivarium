import gettext

from motioneye import config, settings

gettext.install("motioneye")
settings.CONF_PATH = "/etc/motioneye"

for camera_id in range(1, 5):
    config.add_camera(
        {
            "proto": "netcam",
            "scheme": "http",
            "host": "127.0.0.1",
            "port": "9900",
            "path": f"/cam{camera_id}.jpg",
            "username": "",
            "password": "",
        }
    )
