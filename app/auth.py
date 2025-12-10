from flask import Blueprint, flash, redirect, render_template, request, url_for
from flask_login import current_user, login_required, login_user, logout_user

from . import db
from .forms import AdminLoginForm, AdminRegistrationForm, LoginForm, RegistrationForm
from .models import User
from .utils import can_attempt_login, clear_failed_logins, record_failed_login

auth_bp = Blueprint("auth", __name__)


@auth_bp.route("/register", methods=["GET", "POST"])
def register():
    if current_user.is_authenticated:
        if current_user.is_admin:
            return redirect(url_for("admin.dashboard"))
        return redirect(url_for("main.dashboard"))
    form = RegistrationForm()
    if form.validate_on_submit():
        if User.query.filter_by(username=form.username.data).first():
            flash("账号已存在，请直接登录", "error")
        else:
            is_admin = form.role.data == "admin"
            user = User(username=form.username.data, is_admin=is_admin)
            user.set_password(form.password.data)
            db.session.add(user)
            db.session.commit()
            login_user(user)
            flash("注册成功，欢迎来到共享听歌房", "success")
            target = "admin.dashboard" if is_admin else "main.dashboard"
            return redirect(url_for(target))
    return render_template("auth/register.html", form=form, page="user")


@auth_bp.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated and not current_user.is_admin:
        return redirect(url_for("main.dashboard"))
    form = LoginForm()
    if form.validate_on_submit():
        username = form.username.data
        if not can_attempt_login(username):
            flash("操作频繁，请 1 分钟后重试", "error")
            return render_template("auth/login.html", form=form, page="user")
        user = User.query.filter_by(username=username, is_admin=False).first()
        if user and user.check_password(form.password.data):
            clear_failed_logins(username)
            login_user(user)
            flash("登录成功", "success")
            return redirect(url_for("main.dashboard"))
        record_failed_login(username)
        flash("账号或密码错误", "error")
    return render_template("auth/login.html", form=form, page="user")


@auth_bp.route("/logout", methods=["GET", "POST"])
@auth_bp.route("/admin/logout", methods=["GET", "POST"])
@login_required
def logout():
    is_admin = current_user.is_admin
    logout_user()
    flash("已安全退出", "info")
    if is_admin:
        return redirect(url_for("auth.admin_login"))
    return redirect(url_for("auth.login"))


@auth_bp.route("/admin/register", methods=["GET", "POST"])
def admin_register():
    if current_user.is_authenticated and current_user.is_admin:
        return redirect(url_for("admin.dashboard"))
    form = AdminRegistrationForm()
    if form.validate_on_submit():
        if User.query.filter_by(username=form.username.data).first():
            flash("管理员账号已存在", "error")
        else:
            user = User(username=form.username.data, is_admin=True)
            user.set_password(form.password.data)
            db.session.add(user)
            db.session.commit()
            flash("管理员注册成功，请登录", "success")
            return redirect(url_for("auth.admin_login"))
    return render_template("auth/register.html", form=form, page="admin")


@auth_bp.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    if current_user.is_authenticated and current_user.is_admin:
        return redirect(url_for("admin.dashboard"))
    form = AdminLoginForm()
    if form.validate_on_submit():
        user = User.query.filter_by(username=form.username.data, is_admin=True).first()
        if user and user.check_password(form.password.data):
            login_user(user)
            flash("管理员登录成功", "success")
            return redirect(url_for("admin.dashboard"))
        flash("账号或密码错误", "error")
    return render_template("auth/login.html", form=form, page="admin")

