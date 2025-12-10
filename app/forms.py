from flask_wtf import FlaskForm
from wtforms import (
    FileField,
    HiddenField,
    PasswordField,
    SelectField,
    StringField,
    SubmitField,
)
from wtforms.validators import (
    DataRequired,
    EqualTo,
    Length,
    Regexp,
)
from wtforms import ValidationError


class SliderRequired:
    """Custom validator ensuring the slider challenge passed."""

    def __call__(self, form, field):
        if field.data != "verified":
            raise ValidationError("请先完成滑块拼图验证")


class RegistrationForm(FlaskForm):
    username = StringField(
        "账号",
        validators=[DataRequired(), Length(min=4, max=32), Regexp(r"^[a-zA-Z0-9_]+$")],
    )
    role = SelectField(
        "账号类型",
        choices=[("user", "普通用户"), ("admin", "管理员")],
        default="user",
        validators=[DataRequired()],
    )
    # [新增] 管理员密钥字段 (不加 DataRequired，因为普通用户不用填)
    secret_key = PasswordField("管理员密钥")
    password = PasswordField("密码", validators=[DataRequired(), Length(min=6, max=64)])
    confirm_password = PasswordField(
        "确认密码",
        validators=[DataRequired(), EqualTo("password", message="两次密码不一致")],
    )
    slider_token = HiddenField(validators=[SliderRequired()])
    submit = SubmitField("注册")

    def validate_username(self, field):
        role = self.role.data or "user"
        if role == "admin":
            if not field.data.startswith("admin_"):
                raise ValidationError("管理员账号需以 admin_ 开头")
            if len(field.data) < 8:
                raise ValidationError("管理员账号长度需≥8 个字符")
        else:
            if field.data.startswith("admin_"):
                raise ValidationError("普通用户账号无需 admin_ 前缀")


class LoginForm(FlaskForm):
    username = StringField("账号", validators=[DataRequired()])
    password = PasswordField("密码", validators=[DataRequired()])
    submit = SubmitField("登录")


class ProfileForm(FlaskForm):
    nickname = StringField("昵称", validators=[DataRequired(), Length(max=10)])
    avatar = FileField("上传头像")
    submit = SubmitField("更新资料")


class MusicUploadForm(FlaskForm):
    title = StringField("歌曲名称", validators=[DataRequired(), Length(max=64)])
    file = FileField("MP3 文件", validators=[DataRequired()])
    submit = SubmitField("上传音乐")


class RoomCreateForm(FlaskForm):
    name = StringField("房间名称", validators=[DataRequired(), Length(max=32)])
    submit = SubmitField("立即创建")


class RoomJoinForm(FlaskForm):
    code = StringField(
        "房间号", validators=[DataRequired(), Regexp(r"^[0-9]{6}$", message="请输入 6 位数字房间号")]
    )
    submit = SubmitField("加入房间")


class AdminRegistrationForm(RegistrationForm):
    role = HiddenField(default="admin", validators=[DataRequired()])
    secret_key = PasswordField("管理员密钥", validators=[DataRequired()])
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.role.data = "admin"


class AdminLoginForm(LoginForm):
    pass

