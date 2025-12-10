from flask import Blueprint, abort, flash, redirect, render_template, request, url_for
from flask_login import current_user, login_required

from . import db
from .models import Music, User

admin_bp = Blueprint("admin", __name__, url_prefix="/admin")


def _admin_required():
    if not current_user.is_authenticated or not current_user.is_admin:
        abort(403)


@admin_bp.route("/")
@login_required
def dashboard():
    _admin_required()
    pending = Music.query.filter_by(status="pending").order_by(Music.uploaded_at.asc()).all()
    rejected = Music.query.filter_by(status="rejected").order_by(Music.uploaded_at.desc()).all()
    return render_template("admin/dashboard.html", pending=pending, rejected=rejected)


@admin_bp.post("/music/<int:music_id>/approve")
@login_required
def approve_music(music_id):
    _admin_required()
    music = Music.query.filter_by(id=music_id).first_or_404()
    music.status = "approved"
    music.rejection_reason = None
    db.session.commit()
    flash("音乐审核已通过", "success")
    return redirect(url_for("admin.dashboard"))


@admin_bp.post("/music/<int:music_id>/reject")
@login_required
def reject_music(music_id):
    _admin_required()
    reason = request.form.get("reason", "上传音乐涉及违规内容，已驳回删除")
    music = Music.query.filter_by(id=music_id).first_or_404()
    music.status = "rejected"
    music.rejection_reason = reason
    owner: User = music.owner
    owner.notification_message = "上传音乐涉及违规内容，已驳回删除"
    db.session.commit()
    flash("音乐已标记为违规并通知上传者", "info")
    return redirect(url_for("admin.dashboard"))

