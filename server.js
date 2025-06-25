const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

const clients = new Map();
const pendingRequests = new Map();
const clientHeartbeats = new Map();

const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const REQUEST_TIMEOUT = 60000; // 1 minute
const MAX_RECONNECT_ATTEMPTS = 5;

app.use(cors({ origin: '*' }));
// Increase payload size limit to 50MB
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

function generateRequestId() {
    return Math.random().toString(36).substr(2, 9);
}

// Heartbeat check
setInterval(() => {
    const now = Date.now();
    for (const [id, lastHeartbeat] of clientHeartbeats.entries()) {
        if (now - lastHeartbeat > HEARTBEAT_INTERVAL * 2) {
            const ws = clients.get(id);
            if (ws) {
                ws.terminate();
                clients.delete(id);
                clientHeartbeats.delete(id);
                console.log('🔌 Client ' + id + ' disconnected due to heartbeat timeout');
            }
        }
    }
}, HEARTBEAT_INTERVAL);

app.post('/call', (req, res) => {
    const { id, apiname, apiparams } = req.body;

    console.log(req.headers, req.body);

    if (!id || !apiname) {
        return res.status(400).json({ error: 'Missing required parameters' });
    }

    const ws = clients.get(id);
    if (!ws) {
        return res.status(404).json({ error: 'Client not connected' });
    }

    const requestId = generateRequestId();
    pendingRequests.set(requestId, res);

    try {
        ws.send(
            JSON.stringify({
                type: 'api_call',
                requestId,
                apiname,
                apiparams
            })
        );
    } catch (err) {
        pendingRequests.delete(requestId);
        return res.status(500).json({ error: 'Failed to send request to client' });
    }

    setTimeout(() => {
        if (pendingRequests.has(requestId)) {
            res.status(504).json({ error: 'Timeout waiting for response' });
            pendingRequests.delete(requestId);
        }
    }, REQUEST_TIMEOUT);
});

// New endpoint to handle download requests from client
app.post('/download', async (req, res) => {
    const { results, originalUrl, apiName } = req.body;

    if (!results || !Array.isArray(results)) {
        return res.status(400).json({ error: 'Invalid data received' });
    }

    console.log(`📥 Received download request for ${results.length} items. API: ${apiName}`);

    // REMOVED: Logic để trích xuất username từ originalUrl chung ở đây
    // Vì mỗi item sẽ có username riêng của nó

    let downloadCount = 0;
    let errorCount = 0;
    let successUserDirs = new Set(); // Theo dõi các thư mục người dùng đã được tạo thành công

    // Helper function để xác định loại file từ buffer
    function getFileTypeFromBuffer(buffer) {
        if (!buffer || buffer.length < 4) {
            return null;
        }
        const signature = buffer.toString('hex', 0, 4);
        // Image types
        if (signature.startsWith('ffd8')) return 'jpg'; // JPEG
        if (signature.startsWith('89504e47')) return 'png'; // PNG
        if (signature.startsWith('47494638')) return 'gif'; // GIF
        if (signature.startsWith('52494646') && buffer.toString('hex', 8, 12) === '57454250') return 'webp'; // WEBP
        // Video types (basic checks for MP4)
        if (signature.startsWith('000000') && buffer.toString('hex', 4, 8) === '66747970') return 'mp4'; // MP4 (starts with ftyp)
        if (signature.startsWith('494433')) return 'mp3'; // MP3
        return null;
    }

    // Helper function để định dạng thời gian từ timestamp
    function formatTimestamp(timestamp) {
        if (!timestamp) return 'N/A';
        let date;
        // Kiểm tra xem timestamp có vẻ là mili giây hay giây
        // Một timestamp mili giây thường lớn hơn 10^12
        if (timestamp > 999999999999) { // Ví dụ: 1683948125000 (mili giây)
            date = new Date(timestamp); // Nếu là mili giây, dùng trực tiếp
        } else { // Ví dụ: 1692645576 (giây)
            date = new Date(timestamp * 1000); // Nếu là giây, nhân 1000
        }

        if (isNaN(date.getTime())) { // Kiểm tra xem ngày có hợp lệ không
            return 'N/A';
        }

        const options = {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        };
        // Định dạng dd/mm/yyyy, hh:mm:ss AM/PM
        return date.toLocaleString('en-GB', options).replace(',', '');
    }

    for (const item of results) {
        // Kiểm tra xem item có username và id hợp lệ không
        if (!item.id || !item.username) {
            console.warn('Skipping item without valid ID or username:', item);
            errorCount++;
            continue; // Bỏ qua item này
        }

        const itemUsername = item.username; // Lấy username từ chính item
        // Làm sạch username để đảm bảo tên thư mục hợp lệ
        const safeUsername = itemUsername.replace(/[^a-zA-Z0-9_-]/g, '_'); // Chỉ cho phép chữ, số, gạch ngang, gạch dưới

        const baseDownloadDir = path.join(__dirname, 'result', safeUsername);
        const imageDownloadDir = path.join(baseDownloadDir, 'image');
        const videoDownloadDir = path.join(baseDownloadDir, 'video');

        // Tạo thư mục tải xuống cho USERNAME CỤ THỂ của item này
        // Chỉ cố gắng tạo nếu chưa được tạo thành công trong phiên này
        if (!successUserDirs.has(safeUsername)) {
            try {
                await fs.promises.mkdir(imageDownloadDir, { recursive: true });
                await fs.promises.mkdir(videoDownloadDir, { recursive: true });
                console.log(`Created directories for user ${safeUsername}: ${imageDownloadDir} and ${videoDownloadDir}`);
                successUserDirs.add(safeUsername); // Đánh dấu là đã tạo thành công
            } catch (e) {
                console.error(`Error creating directories for user ${safeUsername}:`, e);
                errorCount++;
                continue; // Bỏ qua item này nếu không tạo được thư mục
            }
        }


        let mediaItemsToDownload = []; // Danh sách tất cả media (ảnh/video chính và carousel)

        // Thêm ảnh/video chính của bài đăng vào danh sách tải xuống (nếu có)
        if (item.image || item.video) {
            mediaItemsToDownload.push({
                id: item.id, // ID của bài đăng chính
                image: item.image,
                video: item.video,
                caption: item.caption,
                accessibility_caption: item.accessibility_caption,
                taken_at_timestamp: item.taken_at_timestamp,
                created_at: item.created_at,
                like_count: item.like_count,
                comment_count: item.comment_count,
                isCarouselChild: false // Đánh dấu đây là item chính
            });
        }

        // Thêm các ảnh/video trong carousel vào danh sách tải xuống
        if (item.carousel && Array.isArray(item.carousel)) {
            item.carousel.forEach((carouselItem, index) => { // Thêm index để đặt tên file
                if (carouselItem.id && (carouselItem.image || carouselItem.video)) {
                    mediaItemsToDownload.push({
                        id: carouselItem.id, // ID riêng của carousel item
                        post_id: item.id, // Sử dụng item.id làm post_id để đặt tên cho carousel child
                        index: index + 1, // Thứ tự trong carousel (bắt đầu từ 1)
                        image: carouselItem.image,
                        video: carouselItem.video,
                        // Các thông tin này thường là của bài đăng chính, nên lấy từ 'item' gốc
                        caption: item.caption,
                        accessibility_caption: item.accessibility_caption,
                        taken_at_timestamp: item.taken_at_timestamp,
                        created_at: item.created_at,
                        like_count: item.like_count,
                        comment_count: item.comment_count,
                        isCarouselChild: true // Đánh dấu đây là item con của carousel
                    });
                }
            });
        }

        // Lặp qua tất cả các media cần tải xuống (bao gồm cả media chính và carousel items)
        for (const mediaItem of mediaItemsToDownload) {
            // Xác định thư mục đích cho media hiện tại
            let currentDownloadDir = null;
            if (mediaItem.video) {
                currentDownloadDir = videoDownloadDir;
            } else if (mediaItem.image) {
                currentDownloadDir = imageDownloadDir;
            } else {
                console.warn(`Skipping mediaItem with no image or video URL:`, mediaItem);
                continue; // Bỏ qua nếu không có URL ảnh hoặc video
            }

            // Tải ảnh
            if (mediaItem.image && currentDownloadDir === imageDownloadDir) {
                const imageUrl = mediaItem.image;
                try {
                    const response = await axios({ url: imageUrl, method: 'GET', responseType: 'arraybuffer' });
                    if (response.status === 200 && response.data) {
                        const fileBuffer = Buffer.from(response.data);
                        const fileType = getFileTypeFromBuffer(fileBuffer);
                        let fileExtension = fileType || 'jpg';
                        if (!fileType) console.warn(`Could not determine image type for ${imageUrl}, defaulting to .jpg`);

                        // Đặt tên file có hậu tố "_pX" nếu là ảnh carousel
                        const fileName = mediaItem.isCarouselChild ? `${mediaItem.post_id}_p${mediaItem.index}.${fileExtension}` : `${mediaItem.id}.${fileExtension}`;
                        const filePath = path.join(currentDownloadDir, fileName);
                        await fs.promises.writeFile(filePath, fileBuffer);
                        console.log(`Downloaded image: ${fileName} for ${itemUsername}`);
                        downloadCount++;

                        // Lưu vào saved_images.json chỉ cho bài đăng chính (không phải item con của carousel)
                        if (!mediaItem.isCarouselChild) {
                            let savedList = readSavedList();
                            const exists = savedList.some(e => e.username === itemUsername && e.id === item.id);
                            if (!exists) {
                                savedList.push({ username: itemUsername, id: item.id });
                                writeSavedList(savedList);
                            }
                        }

                    } else {
                        console.error(`Error downloading image ${imageUrl}: Received status code ${response.status} or no data`);
                        errorCount++;
                    }
                } catch (e) {
                    console.error(`Error fetching or writing image ${imageUrl}:`, e.message);
                    errorCount++;
                }
            }

            // Tải video
            if (mediaItem.video && currentDownloadDir === videoDownloadDir) {
                const videoUrl = mediaItem.video;
                try {
                    const response = await axios({ url: videoUrl, method: 'GET', responseType: 'arraybuffer' });
                    if (response.status === 200 && response.data) {
                        const fileBuffer = Buffer.from(response.data);
                        const fileType = getFileTypeFromBuffer(fileBuffer);
                        let fileExtension = fileType || 'mp4';
                        if (!fileType) console.warn(`Could not determine video type for ${videoUrl}, defaulting to .mp4`);

                        // Đặt tên file có hậu tố "_pX" nếu là video carousel
                        const fileName = mediaItem.isCarouselChild ? `${mediaItem.post_id}_p${mediaItem.index}.${fileExtension}` : `${mediaItem.id}.${fileExtension}`;
                        const filePath = path.join(currentDownloadDir, fileName);
                        await fs.promises.writeFile(filePath, fileBuffer);
                        console.log(`Downloaded video: ${fileName} for ${itemUsername}`);
                        downloadCount++;

                        // Lưu vào saved_images.json chỉ cho bài đăng chính (không phải item con của carousel)
                        if (!mediaItem.isCarouselChild) {
                            let savedList = readSavedList();
                            const exists = savedList.some(e => e.username === itemUsername && e.id === item.id);
                            if (!exists) {
                                savedList.push({ username: itemUsername, id: item.id });
                                writeSavedList(savedList);
                            }
                        }

                    } else {
                        console.error(`Error downloading video ${videoUrl}: Received status code ${response.status} or no data`);
                        errorCount++;
                    }
                } catch (e) {
                    console.error(`Error fetching or writing video ${videoUrl}:`, e.message);
                    errorCount++;
                }
            }
        } // Kết thúc vòng lặp mediaItemsToDownload

        // Lưu file chú thích (caption)
        if (item.accessibility_caption !== undefined || item.caption !== undefined) {
            const captionText = item.accessibility_caption || item.caption || '(No caption)';
            let fullCaptionContent = `Caption text: ${captionText}\n`;

            if (item.taken_at_timestamp) {
                fullCaptionContent += `Created: ${formatTimestamp(item.taken_at_timestamp)}\n`;
            } else if (item.created_at) {
                fullCaptionContent += `Created: ${formatTimestamp(item.created_at)}\n`;
            } else {
                fullCaptionContent += `Created: N/A\n`;
            }

            fullCaptionContent += `Likes: ${item.like_count !== undefined ? item.like_count : 'N/A'}\n`;
            fullCaptionContent += `Comments: ${item.comment_count !== undefined ? item.comment_count : 'N/A'}\n`;

            const captionName = `${item.id}.txt`; // Tên file caption theo ID của bài đăng chính
            // Chọn thư mục đích cho caption: ưu tiên thư mục ảnh, sau đó video, cuối cùng là thư mục gốc của user
            const captionPath = path.join(
                (item.image && imageDownloadDir) || (item.video && videoDownloadDir) || baseDownloadDir,
                captionName
            );

            try {
                await fs.promises.writeFile(captionPath, fullCaptionContent);
                console.log(`Saved caption: ${captionName} for ${itemUsername}`);
                downloadCount++;
            } catch (e) {
                console.error(`Error saving caption ${captionName} for user ${itemUsername}:`, e);
                errorCount++;
            }
        }
    } // Kết thúc vòng lặp results chính

    console.log(`✅ Download process finished. Downloaded: ${downloadCount}, Errors: ${errorCount}`);

    if (errorCount === 0) {
        res.status(200).json({ message: `Downloaded ${downloadCount} files.` }); // Đã bỏ 'to ${baseDownloadDir}' vì giờ có nhiều baseDownloadDir
    } else {
        res.status(500).json({ error: `Finished with ${errorCount} errors. Downloaded ${downloadCount} files. Check server logs for details.` });
    }
});

// Endpoint kiểm tra ảnh đã lưu
app.post('/check-saved', async (req, res) => {
    const { username, ids } = req.body;
    if (!username || !Array.isArray(ids)) {
        return res.status(400).json({ error: 'Missing username or ids' });
    }
    // Đảm bảo username được làm sạch
    const safeUsername = username.replace(/[^a-zA-Z0-9_-]/g, '_');
    const imageDir = path.join(__dirname, 'result', safeUsername, 'image'); // Sử dụng safeUsername
    let savedIds = [];
    for (const id of ids) {
        // Kiểm tra các đuôi phổ biến
        const exts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4']; // Thêm mp4 nếu video cũng được coi là 'saved'
        let found = false;
        for (const ext of exts) {
            const filePath = path.join(imageDir, `${id}.${ext}`);
            // Kiểm tra trong thư mục image
            if (fs.existsSync(filePath)) {
                savedIds.push(id);
                found = true;
                break;
            }
            // Nếu không tìm thấy trong image, kiểm tra trong video (chỉ cho mp4)
            if (!found && ext === 'mp4') {
                const videoDir = path.join(__dirname, 'result', safeUsername, 'video'); // Đường dẫn thư mục video
                const videoPath = path.join(videoDir, `${id}.${ext}`);
                if (fs.existsSync(videoPath)) {
                    savedIds.push(id);
                    found = true;
                    break;
                }
            }
        }
    }
    res.json({ saved: savedIds });
});

// Helper: Đọc file JSON lưu danh sách ảnh đã lưu
function readSavedList() {
    const filePath = path.join(__dirname, 'result', 'saved_images.json');
    try {
        // Đảm bảo thư mục 'result' tồn tại trước khi đọc/ghi file
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        if (!fs.existsSync(filePath)) {
            return [];
        }
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        console.error("Error reading or parsing saved_images.json:", e);
        return [];
    }
}

// Helper: Ghi file JSON lưu danh sách ảnh đã lưu
function writeSavedList(list) {
    const filePath = path.join(__dirname, 'result', 'saved_images.json');
    try {
        // Đảm bảo thư mục 'result' tồn tại trước khi ghi file
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(list, null, 2), 'utf8');
    } catch (e) {
        console.error("Error writing saved_images.json:", e);
    }
}

// Endpoint trả về danh sách ảnh đã lưu
app.get('/saved-list', (req, res) => {
    res.json({ list: readSavedList() });
});

// --- LƯU THỨ TỰ URL ĐÃ SHUFFLE ---
app.post('/save-shuffled-urls', async (req, res) => {
    const { apiName, urls, timestamp } = req.body;
    if (!apiName || !Array.isArray(urls) || !timestamp) {
        return res.status(400).json({ error: 'Missing apiName, urls, or timestamp' });
    }
    const filePath = path.join(__dirname, 'result', `shuffled_urls_${apiName}.jsonl`);
    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.appendFileSync(filePath, JSON.stringify({ apiName, urls, timestamp }) + '\n', 'utf8');
        res.json({ message: 'Shuffled URLs saved.' });
    } catch (e) {
        console.error('Error saving shuffled URLs:', e);
        res.status(500).json({ error: 'Failed to save shuffled URLs' });
    }
});

// --- LƯU REPORT CHI TIẾT SAU MỖI LẦN GỌI ---
app.post('/save-ig-user-stories-report', async (req, res) => {
    const { apiName, report, timestamp } = req.body;
    if (!apiName || !Array.isArray(report) || !timestamp) {
        return res.status(400).json({ error: 'Missing apiName, report, or timestamp' });
    }
    const filePath = path.join(__dirname, 'result', `ig_user_stories_reportl`);
    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.appendFileSync(filePath, JSON.stringify({ apiName, report, timestamp }) + '\n', 'utf8');
        res.json({ message: 'Report saved.' });
    } catch (e) {
        console.error('Error saving report:', e);
        res.status(500).json({ error: 'Failed to save report' });
    }
});

const server = app.listen(port, () => {
    console.log('🌐 Server running on port ' + port);
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
    console.log('⚡ WebSocket connected');

    let clientId = null;
    let reconnectAttempts = 0;

    ws.on('message', msg => {
        try {
            const data = JSON.parse(msg);

            if (data.type === 'register') {
                if (clientId) {
                    console.log(
                        '⚠️ Client ' + data.id + ' already registered, updating connection'
                    );
                }
                clientId = data.id;
                clients.set(clientId, ws);
                clientHeartbeats.set(clientId, Date.now());
                console.log('✅ Registered client: ' + clientId + ' (total: ' + clients.size + ')');
                reconnectAttempts = 0;
            } else if (data.type === 'response') {
                const res = pendingRequests.get(data.requestId);
                console.log('response', data);
                if (res) {
                    res.json({ result: data.result, error: data.error });
                    pendingRequests.delete(data.requestId);
                }
            } else if (data.type === 'heartbeat') {
                if (clientId) {
                    clientHeartbeats.set(clientId, Date.now());
                }
            } else if (data.type === 'reconnect') {
                if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                    ws.send(
                        JSON.stringify({
                            type: 'error',
                            error: 'Maximum reconnection attempts reached'
                        })
                    );
                    ws.close();
                    return;
                }
                reconnectAttempts++;
                console.log(
                    '🔄 Reconnection attempt ' + reconnectAttempts + ' for client ' + clientId
                );
            }
        } catch (err) {
            console.error('❌ Invalid message', err);
        }
    });

    ws.on('close', () => {
        if (clientId) {
            clients.delete(clientId);
            clientHeartbeats.delete(clientId);
            console.log(
                '🔌 WebSocket disconnected: ' + clientId + ' (total: ' + clients.size + ')'
            );
        }
    });

    ws.on('error', error => {
        console.error('❌ WebSocket error for client ' + clientId + ':', error);
    });

    // Send initial heartbeat request
    ws.send(JSON.stringify({ type: 'heartbeat_request' }));
});

// Error handling for the server
server.on('error', error => {
    console.error('❌ Server error:', error);
});

process.on('uncaughtException', error => {
    console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});