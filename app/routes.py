from datetime import datetime, timedelta
from pathlib import Path

from flask import (
    Blueprint,
    abort,
    flash,
    jsonify,
    redirect,
    render_template,
    request,
    url_for,
)
from flask_login import current_user, login_required

from . import db
from .forms import MusicUploadForm, ProfileForm, RoomCreateForm, RoomJoinForm
from .models import (
    ListenRecord,
    Music,
    Room,
    RoomMember,
    RoomMessage,
    RoomParticipationRecord,
    RoomPlaylist,
    User,
)
from .utils import generate_room_code, generate_room_name, save_avatar, save_music

main_bp = Blueprint("main", __name__)


@main_bp.route("/")
def index():
    if current_user.is_authenticated:
        if current_user.is_admin:
            return redirect(url_for("admin.dashboard"))
        return redirect(url_for("main.dashboard"))
    return render_template("public/landing.html")


@main_bp.route("/dashboard")
@login_required
def dashboard():
    if current_user.is_admin:
        return redirect(url_for("admin.dashboard"))
    room_form = RoomCreateForm()
    if not room_form.name.data:
        room_form.name.data = generate_room_name()
    join_form = RoomJoinForm()
    pending_notice = current_user.notification_message
    if pending_notice:
        current_user.notification_message = None
        db.session.commit()
        flash(pending_notice, "warning")
    return render_template(
        "dashboard.html",
        room_form=room_form,
        join_form=join_form,
    )


@main_bp.route("/profile", methods=["GET", "POST"])
@login_required
def profile():
    if current_user.is_admin:
        abort(403)
    form = ProfileForm(obj=current_user)
    if form.validate_on_submit():
        current_user.nickname = form.nickname.data
        avatar_file = request.files.get("avatar")
        if avatar_file and avatar_file.filename:
            stored_name = save_avatar(avatar_file)
            if not stored_name:
                flash("仅支持常见图片格式，大小请控制在 5MB 内", "error")
                return render_template("profile.html", form=form)
            current_user.avatar_path = stored_name
        db.session.commit()
        flash("个人信息已更新", "success")
        return redirect(url_for("main.profile"))
    return render_template("profile.html", form=form)


@main_bp.route("/music", methods=["GET", "POST"])
@login_required
def music():
    if current_user.is_admin:
        abort(403)
    upload_form = MusicUploadForm()
    if upload_form.validate_on_submit():
        file = request.files.get("file")
        if not file or not file.filename:
            flash("请选择 MP3 文件", "error")
        else:
            stored_name, error = save_music(file)
            if error:
                flash(error, "error")
            else:
                title = (upload_form.title.data or "").strip()
                if not title:
                    title = Path(file.filename).stem or "未命名歌曲"
                music = Music(
                    user_id=current_user.id,
                    title=title,
                    original_filename=file.filename,
                    stored_filename=stored_name,
                )
                db.session.add(music)
                db.session.commit()
                flash("请确保上传音乐拥有合法使用权限", "info")
                flash("音乐已进入待审核队列", "success")
                return redirect(url_for("main.music"))
    my_music = Music.query.filter_by(user_id=current_user.id).order_by(Music.uploaded_at.desc()).all()
    return render_template("music.html", upload_form=upload_form, musics=my_music)


@main_bp.route("/music/<int:music_id>/delete", methods=["POST"])
@login_required
def delete_music(music_id):
    if current_user.is_admin:
        abort(403)
    music = Music.query.filter_by(id=music_id, user_id=current_user.id).first_or_404()
    # 同时删除在任何房间播放列表中的引用
    RoomPlaylist.query.filter_by(music_id=music.id).delete()
    db.session.delete(music)
    db.session.commit()
    flash("音乐已删除", "info")
    return redirect(url_for("main.music"))


@main_bp.route("/my-rooms")
@login_required
def my_rooms():
    if current_user.is_admin:
        abort(403)
    owned_rooms = (
        Room.query.filter_by(owner_id=current_user.id).order_by(Room.created_at.desc()).all()
    )
    memberships = (
        RoomMember.query.filter_by(user_id=current_user.id)
        .order_by(RoomMember.joined_at.desc())
        .all()
    )
    return render_template(
        "my_rooms.html",
        owned_rooms=owned_rooms,
        memberships=memberships,
    )


def _generate_unique_room_code():
    while True:
        code = generate_room_code()
        if not Room.query.filter_by(code=code).first():
            return code


@main_bp.route("/rooms/create", methods=["POST"])
@login_required
def create_room():
    if current_user.is_admin:
        abort(403)
    form = RoomCreateForm()
    if not form.validate_on_submit():
        flash("房间名称校验失败", "error")
        return redirect(url_for("main.dashboard"))
    code = _generate_unique_room_code()
    room = Room(owner_id=current_user.id, name=form.name.data or generate_room_name(), code=code)
    db.session.add(room)
    db.session.commit()
    participation = RoomParticipationRecord(user_id=current_user.id, room_code=code)
    db.session.add(participation)
    db.session.commit()
    flash(f"房间创建成功，房间号 {code}", "success")
    return redirect(url_for("main.room_detail", code=code))


@main_bp.route("/rooms/join", methods=["POST"])
@login_required
def join_room():
    if current_user.is_admin:
        abort(403)
    form = RoomJoinForm()
    if not form.validate_on_submit():
        flash("请输入正确的 6 位房间号", "error")
        return redirect(url_for("main.dashboard"))
    room = Room.query.filter_by(code=form.code.data).first()
    if not room:
        flash("房间不存在或已关闭", "error")
        return redirect(url_for("main.dashboard"))
    if not room.is_active:
        flash("房间已关闭，暂不可加入", "error")
        return redirect(url_for("main.dashboard"))
    _attach_member(room, current_user)
    flash("加入成功，祝你听歌愉快", "success")
    return redirect(url_for("main.room_detail", code=room.code))


def _attach_member(room: Room, user: User, *, record_participation: bool = True):
    if not room.is_active:
        return
    if room.owner_id == user.id:
        return
    existing = RoomMember.query.filter_by(room_id=room.id, user_id=user.id).first()
    created_now = False
    if not existing:
        membership = RoomMember(room_id=room.id, user_id=user.id)
        db.session.add(membership)
        created_now = True
    if record_participation or created_now:
        record = RoomParticipationRecord(user_id=user.id, room_code=room.code)
        db.session.add(record)
    db.session.commit()


@main_bp.route("/rooms/<code>")
@login_required
def room_detail(code):
    if current_user.is_admin:
        abort(403)
    room = Room.query.filter_by(code=code).first_or_404()
    if not room.is_active and room.owner_id != current_user.id:
        flash("房间已关闭，无法进入", "error")
        return redirect(url_for("main.dashboard"))
    if room.owner_id != current_user.id:
        _attach_member(room, current_user, record_participation=False)

    # 获取房间播放列表
    room_playlist = RoomPlaylist.query.filter_by(room_id=room.id).order_by(RoomPlaylist.created_at.asc()).all()

    # 获取用户自己的已审核音乐（用于添加到房间）
    my_approved_music = (
        Music.query.filter_by(user_id=current_user.id, status="approved")
        .order_by(Music.uploaded_at.desc())
        .all()
    )

    messages = RoomMessage.query.filter_by(room_id=room.id).order_by(RoomMessage.created_at.asc()).all()

    return render_template(
        "room.html",
        room=room,
        is_owner=room.owner_id == current_user.id,
        room_playlist=room_playlist,
        my_library=my_approved_music,
        messages=messages,
    )

'''
@main_bp.route("/rooms/<code>/state")
@login_required
def room_state(code):
    room = Room.query.filter_by(code=code).first_or_404()
    if not room.is_active and room.owner_id != current_user.id:
        abort(403)
    return jsonify(
        {
            "playback_status": room.playback_status,
            "current_track_name": room.current_track_name,
            "current_track_file": room.current_track_file,
            "is_active": room.is_active,
            "updated_at": room.updated_at.isoformat() if room.updated_at else None,
        }
    )


@main_bp.route("/rooms/<code>/toggle", methods=["POST"])
@login_required
def toggle_playback(code):
    room = Room.query.filter_by(code=code).first_or_404()
    if room.owner_id != current_user.id:
        abort(403)

    music_id = request.form.get("music_id")
    action = request.form.get("action")

    # 房主切歌逻辑
    if music_id:
        music = Music.query.get(music_id)
        # 确保音乐存在且是该房间播放列表中的（简单校验存在即可）
        if music and music.status == "approved":
            room.current_track_name = music.title
            room.current_track_file = music.stored_filename
            # 切歌时自动播放
            room.playback_status = "playing"
            # 记录听歌历史
            record = ListenRecord(user_id=current_user.id, song_name=music.title)
            db.session.add(record)
        else:
            flash("无法播放该歌曲", "error")

    # 房主播放/暂停逻辑
    elif action in {"play", "pause"}:
        room.playback_status = "playing" if action == "play" else "paused"
        if room.current_track_name and action == "play":
            # 只有在有歌且从暂停恢复播放时记录，防止频繁记录，这里简化为只要播放就记录一次
            # 为了避免重复，这里可以加个判断，暂略
            pass

    db.session.commit()
    return redirect(url_for("main.room_detail", code=code))

'''

@main_bp.route("/rooms/<code>/playlist/add", methods=["POST"])
@login_required
def add_to_playlist(code):
    room = Room.query.filter_by(code=code).first_or_404()
    music_id = request.form.get("music_id")

    if not music_id:
        flash("请选择音乐", "error")
        return redirect(url_for("main.room_detail", code=code))

    music = Music.query.filter_by(id=music_id, user_id=current_user.id, status="approved").first()
    if not music:
        flash("音乐不存在或未审核通过", "error")
        return redirect(url_for("main.room_detail", code=code))

    # 检查是否已在列表中（可选，这里允许重复添加）
    # existing = RoomPlaylist.query.filter_by(room_id=room.id, music_id=music.id).first()

    item = RoomPlaylist(room_id=room.id, music_id=music.id)
    db.session.add(item)
    db.session.commit()

    flash(f"已将《{music.title}》添加到房间播放列表", "success")
    return redirect(url_for("main.room_detail", code=code))


@main_bp.route("/rooms/<code>/leave", methods=["POST"])
@login_required
def leave_room(code):
    room = Room.query.filter_by(code=code).first_or_404()
    if room.owner_id == current_user.id:
        flash("房主无法直接退出，如需解散请关闭房间", "warning")
        return redirect(url_for("main.room_detail", code=code))
    membership = RoomMember.query.filter_by(room_id=room.id, user_id=current_user.id).first()
    if membership:
        db.session.delete(membership)
        db.session.commit()
        flash("你已退出房间，可随时再次通过房间号加入", "info")
    else:
        flash("当前未在该房间中", "warning")
    return redirect(url_for("main.dashboard"))


@main_bp.route("/rooms/<code>/availability", methods=["POST"])
@login_required
def room_availability(code):
    room = Room.query.filter_by(code=code).first_or_404()
    if room.owner_id != current_user.id:
        abort(403)
    action = request.form.get("action")
    if action == "close":
        room.is_active = False
        room.playback_status = "paused"
        message = "房间已关闭，成员将无法继续进入"
    elif action == "open":
        room.is_active = True
        message = "房间已重新开放，房间号可继续使用"
    else:
        flash("未知操作", "error")
        return redirect(url_for("main.room_detail", code=code))
    db.session.commit()
    flash(message, "success")
    return redirect(url_for("main.room_detail", code=code))


@main_bp.route("/rooms/<code>/delete", methods=["POST"])
@login_required
def delete_room(code):
    room = Room.query.filter_by(code=code).first_or_404()
    if room.owner_id != current_user.id:
        abort(403)
    RoomMessage.query.filter_by(room_id=room.id).delete(synchronize_session=False)
    RoomMember.query.filter_by(room_id=room.id).delete(synchronize_session=False)
    RoomPlaylist.query.filter_by(room_id=room.id).delete(synchronize_session=False)
    db.session.delete(room)
    db.session.commit()
    flash("房间已删除，房间号不再可用", "info")
    return redirect(url_for("main.my_rooms"))


# @main_bp.route("/rooms/<code>/messages", methods=["POST"])
# @login_required
# def send_message(code):
#     room = Room.query.filter_by(code=code).first_or_404()
#     content = request.form.get("content", "").strip()
#     if not content:
#         flash("评论内容不能为空", "error")
#         return redirect(url_for("main.room_detail", code=code))
#     message = RoomMessage(room_id=room.id, user_id=current_user.id, content=content)
#     db.session.add(message)
#     db.session.commit()
#     flash("已发送", "success")
#     return redirect(url_for("main.room_detail", code=code))


@main_bp.route("/records")
@login_required
def records():
    if current_user.is_admin:
        abort(403)
    cutoff = datetime.utcnow() - timedelta(days=30)
    listen_records = (
        ListenRecord.query.filter(ListenRecord.user_id == current_user.id, ListenRecord.played_at >= cutoff)
        .order_by(ListenRecord.played_at.desc())
        .all()
    )
    room_records = (
        RoomParticipationRecord.query.filter(
            RoomParticipationRecord.user_id == current_user.id,
            RoomParticipationRecord.participated_at >= cutoff,
        )
        .order_by(RoomParticipationRecord.participated_at.desc())
        .all()
    )
    return render_template("records.html", listen_records=listen_records, room_records=room_records)


# app/routes.py

# app/routes.py


@main_bp.route("/rooms/<code>/state")
@login_required
def room_state(code):
    room = Room.query.filter_by(code=code).first_or_404()
    if not room.is_active and room.owner_id != current_user.id:
        abort(403)

    # 1. 智能进度计算
    current_pos = room.current_position
    if room.playback_status == 'playing' and room.updated_at:
        elapsed = (datetime.utcnow() - room.updated_at).total_seconds()
        current_pos += elapsed

    # 2. 聊天记录 (修复：必须返回 messages 字段)
    recent_msgs = RoomMessage.query.filter_by(room_id=room.id) \
        .order_by(RoomMessage.created_at.desc()) \
        .limit(50).all()
    recent_msgs.reverse()
    messages_data = [{
        "id": m.id,
        "author_name": m.author.nickname or m.author.username,
        "author_avatar": m.author.avatar_url,
        "created_at": m.created_at.strftime('%H:%M'),
        "content": m.content
    } for m in recent_msgs]

    # 3. 播放列表 (修复：必须返回 playlist 字段)
    playlist_items = RoomPlaylist.query.filter_by(room_id=room.id) \
        .order_by(RoomPlaylist.created_at.asc()).all()
    playlist_data = [{
        "id": item.id,
        "music_id": item.music.id,
        "title": item.music.title
    } for item in playlist_items]

    return jsonify({
        "playback_status": room.playback_status,
        "current_track_name": room.current_track_name,
        "current_track_file": room.current_track_file,
        "current_position": current_pos,
        "is_active": room.is_active,
        "updated_at": room.updated_at.isoformat() if room.updated_at else None,
        "messages": messages_data,  # 确保前端能收到消息
        "playlist": playlist_data  # 确保前端能收到歌单
    })


@main_bp.route("/rooms/<code>/toggle", methods=["POST"])
@login_required
def toggle_playback(code):
    room = Room.query.filter_by(code=code).first_or_404()
    if room.owner_id != current_user.id:
        abort(403)

    music_id = request.form.get("music_id")
    action = request.form.get("action")

    try:
        position = request.form.get("position", type=float)
    except (ValueError, TypeError):
        position = None

    if music_id:  # 切歌
        music = Music.query.get(music_id)
        if music and music.status == "approved":
            room.current_track_name = music.title
            room.current_track_file = music.stored_filename
            room.playback_status = "playing"
            room.current_position = 0.0
            room.updated_at = datetime.utcnow()
            db.session.add(ListenRecord(user_id=current_user.id, song_name=music.title))
        else:
            flash("无法播放该歌曲", "error")

    elif action in {"play", "pause"}:  # 播放暂停
        room.playback_status = "playing" if action == "play" else "paused"
        if position is not None and position >= 0:
            room.current_position = position
        room.updated_at = datetime.utcnow()

    db.session.commit()
    # 返回 JSON，配合前端 fetch 使用
    return jsonify({"status": "success"})


@main_bp.route("/rooms/<code>/messages", methods=["POST"])
@login_required
def send_message(code):
    room = Room.query.filter_by(code=code).first_or_404()
    content = request.form.get("content", "").strip()
    if not content:
        return jsonify({"error": "内容不能为空"}), 400
    message = RoomMessage(room_id=room.id, user_id=current_user.id, content=content)
    db.session.add(message)
    db.session.commit()
    return jsonify({"status": "success"})


@main_bp.route("/rooms/<code>/playlist/delete", methods=["POST"])
@login_required
def delete_from_playlist(code):
    room = Room.query.filter_by(code=code).first_or_404()
    if room.owner_id != current_user.id:
        abort(403)
    item_id = request.form.get("item_id")
    if item_id:
        entry = RoomPlaylist.query.get(item_id)
        if entry and entry.room_id == room.id:
            db.session.delete(entry)
            db.session.commit()
    return jsonify({"status": "success"})