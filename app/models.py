from datetime import datetime
from pathlib import Path
from flask_login import UserMixin
from werkzeug.security import check_password_hash, generate_password_hash

from . import db, login_manager


class TimestampMixin:
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(
        db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class User(UserMixin, TimestampMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    is_admin = db.Column(db.Boolean, default=False)
    nickname = db.Column(db.String(32), default="新用户")
    avatar_path = db.Column(db.String(256), nullable=True)
    notification_message = db.Column(db.String(256), nullable=True)

    musics = db.relationship("Music", backref="owner", lazy=True)

    def set_password(self, password: str) -> None:
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)

    @property
    def avatar_url(self) -> str:
        if self.avatar_path:
            return f"/static/uploads/avatars/{Path(self.avatar_path).name}"
        return "https://placehold.co/80x80?text=VS"


@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))


class Music(TimestampMixin, db.Model):
    __tablename__ = "musics"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id", ondelete='CASCADE'), nullable=False)#补充一个显式级联删除
    title = db.Column(db.String(128), nullable=False)
    original_filename = db.Column(db.String(255), nullable=False)
    stored_filename = db.Column(db.String(255), nullable=False)
    status = db.Column(db.String(32), default="pending")  # pending/approved/rejected
    rejection_reason = db.Column(db.String(255), nullable=True)
    uploaded_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    def file_url(self) -> str:
        return f"/static/uploads/music/{self.stored_filename}"


class Room(TimestampMixin, db.Model):
    # 单独为 Room 覆盖 created_at 以添加索引，便于按创建时间范围查询
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    id = db.Column(db.Integer, primary_key=True)
    owner_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    name = db.Column(db.String(64), nullable=False)
    code = db.Column(db.String(6), unique=True, nullable=False)
    is_active = db.Column(db.Boolean, default=True)
    playback_status = db.Column(db.String(16), default="paused")
    current_track_name = db.Column(db.String(255), nullable=True)
    current_track_file = db.Column(db.String(255), nullable=True)
    current_position = db.Column(db.Float, default=0.0)

    owner = db.relationship("User", backref="rooms")
    members = db.relationship("RoomMember", backref="room", lazy=True)
    # 新增 playlist 关系
    playlist = db.relationship("RoomPlaylist", backref="room", lazy=True, cascade="all, delete-orphan")
    __table_args__ = (
        db.Index("ix_room_code", "code", unique=True),
    )


class RoomPlaylist(TimestampMixin, db.Model):
    """房间播放列表"""
    id = db.Column(db.Integer, primary_key=True)
    room_id = db.Column(db.Integer, db.ForeignKey("room.id"), nullable=False)
    music_id = db.Column(db.Integer, db.ForeignKey("musics.id"), nullable=False)

    music = db.relationship("Music")


class RoomMessage(TimestampMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    room_id = db.Column(db.Integer, db.ForeignKey("room.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    content = db.Column(db.Text, nullable=False)

    room = db.relationship("Room", backref="messages")
    author = db.relationship("User")


class RoomMember(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    room_id = db.Column(db.Integer, db.ForeignKey("room.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    joined_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint("room_id", "user_id", name="uniq_room_member"),
    )

    user = db.relationship("User")


class ListenRecord(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    song_name = db.Column(db.String(255), nullable=False)
    played_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    user = db.relationship("User", backref="listen_records")


class RoomParticipationRecord(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    room_code = db.Column(db.String(6), nullable=False)
    participated_at = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship("User", backref="room_participations")
