import random
import string
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

from flask import current_app
from werkzeug.utils import secure_filename

FAILED_LOGIN_ATTEMPTS = defaultdict(list)
LOCKOUT_SECONDS = 60
MAX_FAILED_ATTEMPTS = 2


def can_attempt_login(username: str) -> bool:
    now = datetime.utcnow()
    attempts = [
        ts for ts in FAILED_LOGIN_ATTEMPTS.get(username, []) if now - ts < timedelta(seconds=LOCKOUT_SECONDS)
    ]
    FAILED_LOGIN_ATTEMPTS[username] = attempts
    if len(attempts) >= MAX_FAILED_ATTEMPTS:
        return False
    return True


def record_failed_login(username: str) -> None:
    FAILED_LOGIN_ATTEMPTS[username].append(datetime.utcnow())


def clear_failed_logins(username: str) -> None:
    FAILED_LOGIN_ATTEMPTS.pop(username, None)


def _extract_extension(filename: str) -> str:
    return Path(filename).suffix.lower().lstrip(".")


def allowed_file(filename: str, allowed_extensions: set[str]) -> bool:
    if not filename:
        return False
    return _extract_extension(filename) in allowed_extensions


def save_avatar(file_storage) -> str | None:
    if not file_storage:
        return None
    filename = secure_filename(file_storage.filename)
    if not allowed_file(filename, current_app.config["ALLOWED_AVATAR_EXTENSIONS"]):
        return None
    file_storage.seek(0, 2)
    size_mb = file_storage.tell() / (1024 * 1024)
    file_storage.seek(0)
    if size_mb > 5:
        return None
    timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S%f")
    stored_name = f"avatar_{timestamp}_{filename}"
    path = Path(current_app.config["AVATAR_FOLDER"]) / stored_name
    file_storage.save(path)
    return stored_name


def save_music(file_storage) -> tuple[str | None, str | None]:
    if not file_storage:
        return (None, "请选择 MP3 文件")
    original_name = file_storage.filename or ""
    ext = _extract_extension(original_name)
    if not ext:
        return (None, "无法识别文件后缀，请确认文件名包含 .mp3")
    if ext not in current_app.config["ALLOWED_MUSIC_EXTENSIONS"]:
        return (
            None,
            f"仅支持 MP3 格式文件，当前为 .{ext}",
        )
    mimetype = (file_storage.mimetype or "").lower()
    if "mpeg" not in mimetype and "mp3" not in mimetype:
        return (
            None,
            "文件内容不是标准 MP3，请导出为常见 MP3 再上传",
        )
    filename = secure_filename(original_name)
    if not filename:
        filename = f"music.{ext}"
    file_storage.seek(0, 2)
    size_mb = file_storage.tell() / (1024 * 1024)
    file_storage.seek(0)
    if size_mb > current_app.config["MAX_MUSIC_FILE_MB"]:
        return (
            None,
            f"当前文件约 {size_mb:.1f} MB，已超过 {current_app.config['MAX_MUSIC_FILE_MB']} MB 限制",
        )
    timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S%f")
    safe_stem = Path(filename).stem or "music"
    stored_name = f"music_{timestamp}_{safe_stem}.{ext}"
    path = Path(current_app.config["MUSIC_FOLDER"]) / stored_name
    file_storage.save(path)
    return stored_name, None


def generate_room_code() -> str:
    return "".join(random.choices(string.digits, k=6))


def generate_room_name() -> str:
    nouns = ["星球", "海浪", "微风", "晨光", "旅程", "光影"]
    adjectives = ["温柔", "极速", "静谧", "梦幻", "热烈", "复古"]
    return random.choice(adjectives) + random.choice(nouns)

