const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs'); 
const { v4: uuidv4 } = require('uuid'); 
const svgCaptcha = require('svg-captcha'); 
const session = require('express-session'); 
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const port = 3000;
// 🚨 新增：引入原生 http 和 socket.io
const http = require('http');
const { Server } = require('socket.io');

// 🚨 核心改造：将 express 包装进 http server，并挂载 io 引擎
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: 'https://zzjwyc.xyz', // 换成你的前端域名
        credentials: true
    }
});

// 📡 启动量子监听阵列
io.on('connection', (socket) => {
    // 用户前端传来自己的 ID，为其开辟专属雷达频段
    socket.on('register_radar', (userId) => {
        socket.join(`radar_${userId}`);
    });
});
// ================== 1. 基础环境与安全配置 ==================
app.set('trust proxy', 1);

// 🚨 务必换成你前端的公网域名！
const FRONTEND_URL = 'https://zzjwyc.xyz'; 
app.use(cors({
    origin: FRONTEND_URL, 
    credentials: true
}));

app.use(express.json());

app.use(session({
    secret: 'nebula_cyberpunk_secret_key_v2', 
    resave: false,
    saveUninitialized: true,
    cookie: { 
        secure: true,       
        sameSite: 'none',   
        maxAge: 1000 * 60 * 60 * 24 
    }
}));

// ================== 2. 文件系统与上传配置 ==================
// 🚨 终极防御：统一获取绝对物理路径，自动创建uploads文件夹
const uploadDir = path.resolve('uploads/'); // 🔑 改用绝对路径解析
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log('✅ 已自动创建图库物理文件夹:', uploadDir);
}

// 开放静态橱窗
app.use('/uploads', express.static(uploadDir));

// Multer 通用文件名规则
const getUniqueFilename = (prefix, sessionId, originalName) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(originalName); 
    return `${prefix}-${sessionId || 'guest'}-${uniqueSuffix}${ext}`;
};

// 📸 规则 A：头像上传通道
const avatarStorage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, uploadDir); },
    filename: function (req, file, cb) {
        cb(null, getUniqueFilename('avatar', req.session?.user?.id, file.originalname));
    }
});
const uploadAvatar = multer({ storage: avatarStorage, limits: { fileSize: 5 * 1024 * 1024 } });

// 📸 规则 B：画廊动态专属通道
const postStorage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, uploadDir); }, // 🔑 强制物理路径
    filename: function (req, file, cb) {
        // 区分接收原图和缩略图
        const prefix = file.fieldname === 'thumbnail' ? 'thumb' : 'post';
        cb(null, getUniqueFilename(prefix, req.session?.user?.id, file.originalname));
    }
});
const uploadPost = multer({ storage: postStorage, limits: { fileSize: 10 * 1024 * 1024 } });
// 🚨 补上这一段：📸 规则 C：主页背景图专属通道 (最高 10MB)
// ==========================================
const coverStorage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, uploadDir); },
    filename: function (req, file, cb) {
        cb(null, getUniqueFilename('cover', req.session?.user?.id, file.originalname));
    }
});
const uploadCover = multer({ storage: coverStorage, limits: { fileSize: 10 * 1024 * 1024 } });
// ================== 3. 数据库连接 ==================
// 🚨 务必确认你的 MySQL 连接配置正确
const pool = mysql.createPool({
    host: '192.168.5.3', 
    port: 3306,
    user: 'root',
    password: 'zwc', 
    database: 'my_gallery',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});
const promisePool = pool.promise();

async function checkDB() {
    try {
        await promisePool.query("USE my_gallery;");
        console.log("🟢 数据库连接成功！[风控与制裁系统] 已上线！");
    } catch (err) {
        console.error("❌ 数据库连接失败:", err.message);
    }
}
checkDB();
// ==========================================
// 🔍 量子模糊搜索中心 (跨表同时搜用户、题目、内容)
// ==========================================
app.get('/api/search', async (req, res) => {
    const query = req.query.q; // 获取搜索关键字

    // 1. 基础验证
    if (!query || query.trim() === '') {
        return res.status(400).json({ code: 400, message: "请输入搜索内容" });
    }

    const searchTerm = `%${query.trim()}%`; // 建立数据库 LIKE 查询所需的通配符

    try {
        // 2. 🚨 开启多线程并行查询 (大厂标准，绝不排队)
        const [usersPromise, postsPromise] = [
            // A. 查询可能的匹配用户 (模糊搜用户名)
            promisePool.query(
                "SELECT user_id, username, avatar_url FROM user_profiles WHERE username LIKE ?", 
                [searchTerm]
            ),
            // B. 查询可能的匹配画作 (模糊搜题目、内容)
            // 🚨 魔法：为了界面简洁，直接在这里 JOIN 拿到作者头像
            promisePool.query(`
                SELECT p.id, p.title, p.content, p.thumb_url, u.username as author_name, u.avatar_url as author_avatar
                FROM posts p
                LEFT JOIN user_profiles u ON p.user_id = u.user_id
                WHERE p.title LIKE ? OR p.content LIKE ?
            `, [searchTerm, searchTerm])
        ];

        // 3. 等待所有查询结果集结
        const [[users], [posts]] = await Promise.all([usersPromise, postsPromise]);

        // 4. 组装结果并返回
        res.json({
            code: 200,
            message: "✅ 搜索完成",
            results: {
                users: users || [], // 用户匹配项
                posts: posts || []  // 画作匹配项
            }
        });

    } catch (error) {
        console.error("🚨 搜索接口崩溃:", error);
        res.status(500).json({ code: 500, message: "搜索异常，请稍后再试" });
    }
});
// ==========================================
// 🌍 个人主页核心引擎 (支持查看自己与查看他人) - 联合查询修复版
// ==========================================
app.get('/api/users/:id', async (req, res) => {
    const targetId = req.params.id;
    const currentUserId = req.session.user ? req.session.user.id : null;
    let isMe = false;
    let actualTargetId = targetId;

    // 1. 身份智能识别
    if (targetId === 'me') {
        if (!currentUserId) return res.status(401).json({ code: 401, message: "未登录" });
        actualTargetId = currentUserId;
        isMe = true;
    } else if (targetId === currentUserId) {
        isMe = true;
    }

    try {
// 🚨 更新后的查询：把精神状态、坐标、能量值、BGM全拿出来
        const [users] = await promisePool.query(`
            SELECT p.user_id, p.username, p.avatar_url, p.birthday, p.cover_url, p.gender, p.bio, 
                   p.mental_state, p.galaxy_coords, p.creative_energy, p.bgm_id, 
                   a.role 
            FROM user_profiles p
            LEFT JOIN user_auth a ON p.user_id = a.id
            WHERE p.user_id = ?
        `, [actualTargetId]);
        
        if (users.length === 0) return res.status(404).json({ code: 404, message: "👻 浩瀚宇宙，未找到该名星际访客。" });
        const userInfo = users[0];

        // 3. 拉取画廊（权限分级：自己看全部，外人看公开）
        let postsQuery = "";
        let queryParams = [actualTargetId];
        
        if (isMe) {
            postsQuery = "SELECT * FROM posts WHERE user_id = ? ORDER BY created_at DESC";
        } else {
            postsQuery = "SELECT * FROM posts WHERE user_id = ? AND is_public = 1 ORDER BY created_at DESC";
        }
        
        const [posts] = await promisePool.query(postsQuery, queryParams);

        // 4. 返回完整主页数据包
        res.json({
            code: 200,
            isMe: isMe,
            user: userInfo,
            posts: posts
        });
    } catch (error) {
        // 🚨 终极雷达：把底层的真实错误消息打出来！
        console.error("🚨 主页接口遭遇致命崩溃:", error);
        res.status(500).json({ code: 500, message: `服务器崩溃雷达: ${error.message}` });
    }
});
// ==========================================
// 🔧 赛博工作台专属：高级档案重塑接口
// ==========================================
app.put('/api/user/profile/advanced', async (req, res) => {
    // 1. 验证通行证
    if (!req.session.user) return res.status(401).json({ code: 401, message: "未登录" });
    
    // 2. 接收前端面板传来的所有炫酷参数
    const { bio, mental_state, galaxy_coords, creative_energy, birthday } = req.body;
    
    try {
        // 3. 强行覆写进数据库
        await promisePool.query(
            `UPDATE user_profiles 
             SET bio = ?, mental_state = ?, galaxy_coords = ?, creative_energy = ?, birthday = ? 
             WHERE user_id = ?`,
            [
                bio || '', 
                mental_state || ' Void-gazing', 
                galaxy_coords || '', 
                creative_energy || 80, 
                birthday || null, 
                req.session.user.id
            ]
        );
        res.json({ code: 200, message: "✅ 星际档案全息同步完毕！" });
    } catch (error) {
        console.error("🚨 档案重塑遭遇物理学崩塌:", error);
        res.status(500).json({ code: 500, message: "同步失败，请检查数据库连线。" });
    }
});
// ✏️ 全能档案更新接口 (整合签名、性别、生日)
app.put('/api/user/profile', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ code: 401, message: "未登录" });
    const { bio, gender, birthday } = req.body;
    try {
        await promisePool.query(
            "UPDATE user_profiles SET bio = ?, gender = ?, birthday = ? WHERE user_id = ?",
            [bio || '', gender || 'secret', birthday || null, req.session.user.id]
        );
        res.json({ code: 200, message: "✅ 星际档案已更新" });
    } catch (error) {
        res.status(500).json({ code: 500, message: "更新失败" });
    }
});

// 🖼️ 背景图专属上传接口 (复用你的 upload 中间件)
// ❌ 把原来这行：
// app.post('/api/user/cover', upload.single('cover'), async (req, res) => {

// ✅ 换成这行：
app.post('/api/user/cover', uploadCover.single('cover'), async (req, res) => {
    if (!req.session.user) return res.status(401).json({ code: 401, message: "未登录" });
    if (!req.file) return res.status(400).json({ code: 400, message: "请选择背景图片" });

    const coverUrl = `/uploads/${req.file.filename}`;
    try {
        await promisePool.query("UPDATE user_profiles SET cover_url = ? WHERE user_id = ?", [coverUrl, req.session.user.id]);
        res.json({ code: 200, message: "背景更换成功", data: { coverUrl } });
    } catch (error) {
        res.status(500).json({ code: 500, message: "背景上传失败" });
    }
});

// ✅ 恢复成原本完美运行的版本
app.get('/api/captcha', (req, res) => {
    const captcha = svgCaptcha.create({
        size: 4, ignoreChars: '0o1il', noise: 2, color: true, background: '#f4f4f5'
    });
    req.session.captcha = captcha.text.toLowerCase();
    // 恢复 JSON 格式返回，让前端能够正确读取 res.data.data
    res.json({ code: 200, data: captcha.data }); 
});

// 🚨 改造后的注册接口：注册成功后直接写入 session，实现自动登录
app.post('/api/register', async (req, res) => {
    const { username, email, password, captcha } = req.body;
    if (!req.session.captcha || req.session.captcha !== captcha.toLowerCase()) {
        return res.status(400).json({ code: 400, message: "❌ 验证码错误或已过期，请刷新！" });
    }
    try {
        const [blacklisted] = await promisePool.query("SELECT id FROM blacklisted_emails WHERE email = ?", [email]);
        if (blacklisted.length > 0) return res.status(403).json({ code: 403, message: "⛔ 您的邮箱已被永久拒绝访问！" });

        const salt = bcrypt.genSaltSync(10);
        const passwordHash = bcrypt.hashSync(password, salt);
        const userId = uuidv4();

        await promisePool.query("INSERT INTO user_auth (id, email, password_hash) VALUES (?, ?, ?)", [userId, email, passwordHash]);
        await promisePool.query("INSERT INTO user_profiles (user_id, username) VALUES (?, ?)", [userId, username]);

        req.session.captcha = null; 
        
        // 🌟 核心魔法：注册成功后，直接在后端给他签发通行证（Session）
        req.session.user = { id: userId, email: email, role: 1 };
        
        // 告诉前端：你已经是登录状态了！
        res.json({ 
            code: 200, 
            message: "档案建立成功！已为您自动连接星际网络。",
            user: { username: username, email: email, role: 1 } 
        });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') res.status(400).json({ code: 400, message: "❌ 该邮箱已被注册，请更换！" });
        else res.status(500).json({ code: 500, message: "服务器内部错误，请稍后再试。" });
    }
});

// 🔐 装甲版登录接口：支持用户名/邮箱双登，自带精确报错雷达！
app.post('/api/login', async (req, res) => {
    // 1. 提取参数：兼容前端传来的是 email、username 还是 account
    const loginAccount = req.body.email || req.body.username || req.body.account;
    const password = req.body.password;
    const captcha = req.body.captcha;

    // 2. 验证码防线 (极其严格)
    if (!captcha || !req.session.captcha || req.session.captcha !== captcha.toLowerCase()) {
        return res.status(400).json({ code: 400, message: "❌ 验证码错误或已失效，请点击图片刷新！" });
    }

    if (!loginAccount || !password) {
        return res.status(400).json({ code: 400, message: "❌ 请输入账号和密码！" });
    }

    try {
        // 3. 联合查询：不管输入的是邮箱还是用户名，统统一网打尽！
        const [users] = await promisePool.query(`
            SELECT a.id, a.email, a.password_hash, p.username, a.role 
            FROM user_auth a 
            LEFT JOIN user_profiles p ON a.id = p.user_id 
            WHERE a.email = ? OR p.username = ?
        `, [loginAccount, loginAccount]);

        if (users.length === 0) return res.status(401).json({ code: 401, message: "❌ 账号或密码错误！" });

        const user = users[0];
        
        // 4. 核对密码
        const isValidPassword = bcrypt.compareSync(password, user.password_hash);
        if (!isValidPassword) return res.status(401).json({ code: 401, message: "❌ 账号或密码错误！" });

        // 5. 验证通过后，立刻销毁这张验证码！
        req.session.captcha = null;

        // 6. 签发通行证
        req.session.user = { id: user.id, email: user.email, role: user.role || 1 };
        res.json({ 
            code: 200, 
            message: "✅ 登录成功！", 
            user: { username: user.username, email: user.email, role: user.role || 1 } 
        });

    } catch (error) {
        // 🚨 终极雷达：如果崩溃了，把真正的死因打印在 NAS 后台，并且直接弹窗告诉你！
        console.error("🚨 登录接口遭遇致命崩溃:", error);
        res.status(500).json({ 
            code: 500, 
            // 把底层的真实错误消息返回给前端弹窗，瞬间破案！
            message: `服务器崩溃雷达: ${error.message}` 
        });
    }
});
// ✏️ 新增：修改画作与动态内容 (支持更换图片或仅修改文字)
app.put('/api/posts/:id', uploadPost.fields([
    { name: 'image', maxCount: 1 }, 
    { name: 'thumbnail', maxCount: 1 }
]), async (req, res) => {
    if (!req.session.user) return res.status(401).json({ code: 401, message: "未登录" });
    const postId = req.params.id;
    const userId = req.session.user.id;
    const { title, content, is_public } = req.body;
    const isPublicNum = (is_public === 'true' || is_public === '1' || is_public === 1) ? 1 : 0;

    try {
        // 先验证这幅画是不是他的
        const [posts] = await promisePool.query("SELECT id FROM posts WHERE id = ? AND user_id = ?", [postId, userId]);
        if (posts.length === 0) return res.status(403).json({ code: 403, message: "⛔ 权限不足" });

        // 如果用户上传了新图片
        if (req.files && req.files['image']) {
            const imageUrl = `/uploads/${req.files['image'][0].filename}`;
            let thumbUrl = imageUrl;
            if (req.files['thumbnail'] && req.files['thumbnail'].length > 0) {
                thumbUrl = `/uploads/${req.files['thumbnail'][0].filename}`;
            }
            await promisePool.query(
                "UPDATE posts SET image_url = ?, thumb_url = ?, title = ?, content = ?, is_public = ? WHERE id = ?",
                [imageUrl, thumbUrl, title || '', content || '', isPublicNum, postId]
            );
        } else {
            // 如果没有传新图片，只更新文字和状态
            await promisePool.query(
                "UPDATE posts SET title = ?, content = ?, is_public = ? WHERE id = ?",
                [title || '', content || '', isPublicNum, postId]
            );
        }
        res.json({ code: 200, message: "✅ 画作档案已更新！" });
    } catch (error) {
        res.status(500).json({ code: 500, message: "更新失败" });
    }
});
// ================== 5. 用户档案模块 (Profile) ==================
// ================== 🌟 站长控制台模块 (Admin) ==================
const requireAdmin = (req, res, next) => {
    if (!req.session.user || req.session.user.role !== 99) return res.status(403).json({ code: 403, message: "⛔ 越权警告！" });
    next();
};

app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        const [users] = await promisePool.query(`
            SELECT a.id, a.email, a.role, a.banned_until, p.username, a.created_at 
            FROM user_auth a JOIN user_profiles p ON a.id = p.user_id ORDER BY a.created_at DESC
        `);
        res.json({ code: 200, data: users });
    } catch (error) {
        res.status(500).json({ code: 500, message: "获取名单失败" });
    }
});

app.post('/api/admin/operate', requireAdmin, async (req, res) => {
    const { targetId, targetEmail, action, days } = req.body;
    if (targetId === req.session.user.id) return res.status(400).json({ code: 400, message: "❌ 不能制裁自己！" });

    try {
        if (action === 'ban') {
            await promisePool.query("UPDATE user_auth SET banned_until = DATE_ADD(NOW(), INTERVAL ? DAY) WHERE id = ?", [days, targetId]);
        } else if (action === 'unban') {
            await promisePool.query("UPDATE user_auth SET banned_until = NULL WHERE id = ?", [targetId]);
        } else if (action === 'blacklist') {
            await promisePool.query("DELETE FROM user_auth WHERE id = ?", [targetId]);
            await promisePool.query("INSERT INTO blacklisted_emails (email, reason) VALUES (?, '最高站长制裁')", [targetEmail]);
        }
        res.json({ code: 200, message: "✅ 制裁指令执行成功！" });
    } catch (error) {
        res.status(500).json({ code: 500, message: "指令执行失败" });
    }
});
app.get('/api/user/profile', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ code: 401, message: "未登录" });
    try {
        const [users] = await promisePool.query(`
            SELECT a.id, p.username, p.avatar_url, p.birthday, a.role 
            FROM user_auth a JOIN user_profiles p ON a.id = p.user_id WHERE a.id = ?
        `, [req.session.user.id]);
        res.json({ code: 200, data: users[0] });
    } catch (error) { res.status(500).json({ code: 500, message: "获取资料失败" }); }
});

app.post('/api/user/avatar', uploadAvatar.single('avatar'), async (req, res) => {
    if (!req.session.user) return res.status(401).json({ code: 401, message: "未登录" });
    if (!req.file) return res.status(400).json({ code: 400, message: "请选择图片" });
    const avatarUrl = `/uploads/${req.file.filename}`; 
    try {
        await promisePool.query("UPDATE user_profiles SET avatar_url = ? WHERE user_id = ?", [avatarUrl, req.session.user.id]);
        res.json({ code: 200, message: "✅ 头像更新成功！", data: { avatarUrl } });
    } catch (error) { res.status(500).json({ code: 500, message: "数据库更新失败" }); }
});

app.post('/api/user/birthday', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ code: 401, message: "未登录" });
    const { birthday } = req.body;
    try {
        await promisePool.query("UPDATE user_profiles SET birthday = ? WHERE user_id = ?", [birthday, req.session.user.id]);
        res.json({ code: 200, message: "星历确立成功！" });
    } catch (error) { res.status(500).json({ code: 500, message: "数据库更新失败" }); }
});

// ================== 6. 画廊动态与双轨制图库 (Posts) ==================

// 🚀 A. 发布新画作 (加强版：双轨制，同时接收原图 image 和缩略图 thumbnail)
app.post('/api/posts', uploadPost.fields([
    { name: 'image', maxCount: 1 }, 
    { name: 'thumbnail', maxCount: 1 } // 前端Canvas压出来的WebP
]), async (req, res) => {
    if (!req.session.user) return res.status(401).json({ code: 401, message: "未登录" });
    
    if (!req.files || !req.files['image']) {
        return res.status(400).json({ code: 400, message: "必须上传一张画作照片！" });
    }

    const { title, content, is_public } = req.body;
    
    // 原图路径 (供详情页/下载用)
    const imageUrl = `/uploads/${req.files['image'][0].filename}`;
    
    // 缩略图路径 (供首页/我的展厅极速预览用)
    let thumbUrl = imageUrl; // 万一前端没传，拿原图顶替
    if (req.files['thumbnail'] && req.files['thumbnail'].length > 0) {
        thumbUrl = `/uploads/${req.files['thumbnail'][0].filename}`;
    }
    
    // 前端传过来的是 boolean，这里安全地转成 INT (1 or 0)
    const isPublicNum = (is_public === 'true' || is_public === '1' || is_public === 1) ? 1 : 0;

    try {
        // 🚨 核心修改：写入数据库的 image_url 和 thumb_url
        await promisePool.query(
            "INSERT INTO posts (user_id, image_url, thumb_url, title, content, is_public) VALUES (?, ?, ?, ?, ?, ?)",
            [req.session.user.id, imageUrl, thumbUrl, title || '', content || '', isPublicNum]
        );
        res.json({ code: 200, message: "✅ 作品及缩略图发布成功！" });
    } catch (error) {
        console.error("【查案日志】作品发布失败:", error);
        res.status(500).json({ code: 500, message: "数据库写入失败" });
    }
});

// 🔒 B. 获取我的展厅 (只看自己的，支持搜索)
app.get('/api/posts/me', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ code: 401, message: "未登录" });
    const { search } = req.query; // 预留搜索功能
    let query = "SELECT * FROM posts WHERE user_id = ?";
    let params = [req.session.user.id];

    if (search) {
        query += " AND (title LIKE ? OR content LIKE ?)";
        params.push(`%${search}%`, `%${search}%`);
    }
    query += " ORDER BY created_at DESC";

    try {
        const [posts] = await promisePool.query(query, params);
        res.json({ code: 200, data: posts });
    } catch (error) { res.status(500).json({ code: 500, message: "获取我的数据失败" }); }
});

// 🌍 C. 获取公开广场 (带终极联表查询：点赞数、评论数、我是否点赞)
app.get('/api/posts/public', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ code: 401, message: "未登录" });
    const userId = req.session.user.id;
    try {
        // 🚨 终极联表子查询 (确保 SQL tables 的 Collation 统一，否则此处会 500)
        const [posts] = await promisePool.query(`
            SELECT 
                p.id, p.user_id, p.image_url, p.thumb_url, p.title, p.content, p.created_at, 
                u.username, u.avatar_url,
                (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS likeCount,
                (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS commentCount,
                EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = ?) AS hasLiked
            FROM posts p
            JOIN user_profiles u ON p.user_id = u.user_id
            WHERE p.is_public = 1
            ORDER BY p.created_at DESC
        `, [userId]);

        // MySQL 的 EXISTS 返回 1/0，转成 JSON 的 true/false
        const formattedPosts = posts.map(post => ({
            ...post,
            hasLiked: post.hasLiked === 1
        }));
        res.json({ code: 200, data: formattedPosts });
    } catch (error) {
        console.error("【查案日志】获取公开广场失败:", error);
        res.status(500).json({ code: 500, message: "获取广场数据失败" });
    }
});

// ================== 7. “我的展厅”高级管理 (Management) ==================

// 🗑️ D. 删除画作
app.delete('/api/posts/:id', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ code: 401, message: "未登录" });
    const userId = req.session.user.id;
    const postId = req.params.id;

    try {
        // 先查查这幅画存不存在，而且是不是这个用户传的
        const [posts] = await promisePool.query("SELECT image_url, thumb_url FROM posts WHERE id = ? AND user_id = ?", [postId, userId]);
        
        if (posts.length === 0) {
            return res.status(403).json({ code: 403, message: "⛔ 权限不足或画作不存在" });
        }

        const { image_url, thumb_url } = posts[0];

        // 🚨 物理删除物理文件 (防止 uploads 文件夹无限爆炸)
        const pImageUrl = path.join(__dirname, image_url);
        if (fs.existsSync(pImageUrl)) fs.unlinkSync(pImageUrl);
        
        // 只有缩略图和原图不同时才删 (兼容旧数据)
        if (image_url !== thumb_url) {
            const pThumbUrl = path.join(__dirname, thumb_url);
            if (fs.existsSync(pThumbUrl)) fs.unlinkSync(pThumbUrl);
        }

        // 🚨 数据库删除：因为 likes, comments 建表时使用了ON DELETE CASCADE，数据库会自动清理点赞评论
        await promisePool.query("DELETE FROM posts WHERE id = ?", [postId]);
        
        res.json({ code: 200, message: "✅ 画作及相关动态已彻底销毁！" });

    } catch (error) {
        console.error("销毁画作失败:", error);
        res.status(500).json({ code: 500, message: "销毁过程发生意外" });
    }
});

// 🌍/🔒 E. 切换公开/私密状态
app.patch('/api/posts/:id/visibility', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ code: 401, message: "未登录" });
    const userId = req.session.user.id;
    const postId = req.params.id;
    const { is_public } = req.body; // 前端传过来的新状态 true/false

    const newIsPublic = is_public ? 1 : 0;

    try {
        // 先核核权限
        const [posts] = await promisePool.query("SELECT id FROM posts WHERE id = ? AND user_id = ?", [postId, userId]);
        if (posts.length === 0) return res.status(403).json({ code: 403, message: "⛔ 权限不足或不存在" });

        await promisePool.query("UPDATE posts SET is_public = ? WHERE id = ?", [newIsPublic, postId]);
        res.json({ code: 200, message: newIsPublic === 1 ? '🎉 作品已成功在广场点亮！' : '🔒 作品已成功存入私人档案箱。' });

    } catch (error) { res.status(500).json({ code: 500, message: "状态更新失败" }); }
});

// ================== 8. 社区互动引擎 (Social & Detail) ==================

// 🔍 F. 获取单个帖子的详细信息 (详情页左右分栏用)
app.get('/api/posts/:id', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ code: 401, message: "未登录" });
    const postId = req.params.id;
    const userId = req.session.user.id;
    try {
        // 查画作作者信息
        const [posts] = await promisePool.query(`
            SELECT p.*, u.username, u.avatar_url 
            FROM posts p JOIN user_profiles u ON p.user_id = u.user_id WHERE p.id = ?
        `, [postId]);

        if (posts.length === 0) return res.status(404).json({ code: 404, message: "画作已销毁" });
        const post = posts[0];

        // 查赞数和我是否点赞
        const [likes] = await promisePool.query("SELECT COUNT(*) as count FROM likes WHERE post_id = ?", [postId]);
        post.likeCount = likes[0].count;
        const [liked] = await promisePool.query("SELECT id FROM likes WHERE post_id = ? AND user_id = ?", [postId, userId]);
        post.hasLiked = liked.length > 0;
        res.json({ code: 200, data: post });
    } catch (error) { res.status(500).json({ code: 500, message: "获取详情失败" }); }
});

// ❤️ G. 点赞/取消点赞 (自动切换)
app.post('/api/posts/:id/like', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ code: 401, message: "未登录" });
    const postId = req.params.id;
    const userId = req.session.user.id;
    try {
        // 先查查点没点过
        const [rows] = await promisePool.query("SELECT id FROM likes WHERE post_id = ? AND user_id = ?", [postId, userId]);
        if (rows.length > 0) {
            await promisePool.query("DELETE FROM likes WHERE post_id = ? AND user_id = ?", [postId, userId]);
            res.json({ code: 200, action: 'unliked' });
        } else {
            await promisePool.query("INSERT INTO likes (post_id, user_id) VALUES (?, ?)", [postId, userId]);
            
            // 🚨 发射雷达信号：查出画作主人，并推送通知 (不要发给自己)
            const [posts] = await promisePool.query("SELECT user_id, title FROM posts WHERE id = ?", [postId]);
            if (posts.length > 0 && posts[0].user_id !== userId) {
                io.to(`radar_${posts[0].user_id}`).emit('radar_alert', {
                    id: Date.now(),
                    type: 'like',
                    message: `有人点亮了你的星辰:《${posts[0].title || '无题'}》`,
                    time: new Date()
                });
            }
            
            res.json({ code: 200, action: 'liked' });
        }
    } catch (error) { res.status(500).json({ code: 500, message: "点赞失败" }); }
});

// 💬 H. 拉取某幅画的所有评论
app.get('/api/posts/:id/comments', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ code: 401, message: "未登录" });
    try {
        // 终极缝合 Collation (如果此时报错 Illeagl mix of collations，请再次运行 SQL SQL SQL)
        const [comments] = await promisePool.query(`
            SELECT c.id, c.user_id, c.content, c.created_at, u.username, u.avatar_url 
    FROM comments c JOIN user_profiles u ON c.user_id = u.user_id 
    WHERE c.post_id = ? ORDER BY c.created_at ASC
        `, [req.params.id]);
        res.json({ code: 200, data: comments });
    } catch (error) { res.status(500).json({ code: 500, message: "获取评论失败" }); }
});

// 📝 I. 发表评论
app.post('/api/posts/:id/comments', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ code: 401, message: "未登录" });
    const { content } = req.body;
    if (!content) return res.status(400).json({ code: 400, message: "评论不能为空" });
    try {
        await promisePool.query("INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)", 
        [req.params.id, req.session.user.id, content]);
        
        // 🚨 发射雷达信号：有人评论了！
        const [posts] = await promisePool.query("SELECT user_id, title FROM posts WHERE id = ?", [req.params.id]);
        if (posts.length > 0 && posts[0].user_id !== req.session.user.id) {
            io.to(`radar_${posts[0].user_id}`).emit('radar_alert', {
                id: Date.now(),
                type: 'comment',
                message: `收到新留言:《${posts[0].title || '无题'}》- "${content.substring(0, 10)}..."`,
                time: new Date()
            });
        }

        res.json({ code: 200, message: "评论发布成功！抢到沙发了！" });
    } catch (error) { res.status(500).json({ code: 500, message: "服务器开小差了，评论失败。" }); }
});

// ================== 启动服务器 ==================

// 🚨 注意：现在是 server.listen，不是 app.listen
server.listen(port, '0.0.0.0', () => {
    console.log(`🟢 商用级后端服务器已启动：http://0.0.0.0:${port}`);
    console.log(`🟢 [私域画廊管理系统 v2] 全线接口就位， uploads 物理路径：${uploadDir}`);

});