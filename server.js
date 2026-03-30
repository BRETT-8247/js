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

// ✅ 恢复成原本完美运行的版本
app.get('/api/captcha', (req, res) => {
    const captcha = svgCaptcha.create({
        size: 4, ignoreChars: '0o1il', noise: 2, color: true, background: '#f4f4f5'
    });
    req.session.captcha = captcha.text.toLowerCase();
    // 恢复 JSON 格式返回，让前端能够正确读取 res.data.data
    res.json({ code: 200, data: captcha.data }); 
});

app.post('/api/register', async (req, res) => {
    const { username, email, password, captcha } = req.body;
    if (!req.session.captcha || req.session.captcha !== captcha.toLowerCase()) {
        return res.status(400).json({ code: 400, message: "❌ 验证码错误！" });
    }
    try {
        const passwordHash = bcrypt.hashSync(password, 10);
        const userId = uuidv4();
        await promisePool.query("INSERT INTO user_auth (id, email, password_hash) VALUES (?, ?, ?)", [userId, email, passwordHash]);
        await promisePool.query("INSERT INTO user_profiles (user_id, username) VALUES (?, ?)", [userId, username]);
        req.session.captcha = null; 
        res.json({ code: 200, message: "档案建立成功！" });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') res.status(400).json({ code: 400, message: "❌ 邮箱已被注册！" });
        else res.status(500).json({ code: 500, message: "服务器错误。" });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const [rows] = await promisePool.query(`
            SELECT a.id, a.email, a.password_hash, a.role, p.username 
            FROM user_auth a JOIN user_profiles p ON a.id = p.user_id WHERE a.email = ?
        `, [email]);
        if (rows.length === 0) return res.status(401).json({ code: 401, message: "❌ 档案不存在！" });
        const user = rows[0];
        if (bcrypt.compareSync(password, user.password_hash)) {
            req.session.user = { id: user.id, email: user.email, role: user.role };
            res.json({ code: 200, message: "验证通过！", user: { username: user.username, role: user.role } });
        } else {
            res.status(401).json({ code: 401, message: "❌ 密钥错误！" });
        }
    } catch (error) {
        res.status(500).json({ code: 500, message: "服务器内部错误" });
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
            SELECT p.username, p.avatar_url, p.birthday, a.role 
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
            SELECT c.id, c.content, c.created_at, u.username, u.avatar_url 
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
        res.json({ code: 200, message: "评论发布成功！抢到沙发了！" });
    } catch (error) { res.status(500).json({ code: 500, message: "服务器开小差了，评论失败。" }); }
});

// ================== 启动服务器 ==================
app.listen(port, '0.0.0.0', () => {
    console.log(`🟢 商用级后端服务器已启动：http://0.0.0.0:${port}`);
    console.log(`🟢 [私域画廊管理系统 v2] 全线接口就位， uploads 物理路径：${uploadDir}`);
});