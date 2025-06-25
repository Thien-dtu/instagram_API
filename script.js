const resultsDiv = document.getElementById('results');
const overallStatusDiv = document.getElementById('overall-status');
const multiUrlProgressDiv = document.getElementById('multi-url-progress');
let allResults = []; // Array to store results from all pages
let isFetching = false; // Flag to indicate if fetching is in progress
const clientId = 'client_gvnsb37p9_100005146594548'; // Hardcoded Client ID
// const clientId = 'client_0ooi5k9f6_100055515698933'; // Hardcoded Client ID

// Default API parameters for different APIs
const defaultApiParams = {
    'get_list_fb_user_photos': JSON.stringify({
        "url": "https://www.facebook.com/trang.quach.526875",
        "type": "5",
        "cursor": ""
    }, null, 2),
    'get_list_fb_user_reels': JSON.stringify({
        "url": "https://www.facebook.com/trang.quach.526875",
        "cursor": ""
    }, null, 2),
    'get_list_fb_highlights': JSON.stringify({
        "url": "https://www.facebook.com/trang.quach.526875",
        "cursor": ""
    }, null, 2),
    'get_list_ig_post': JSON.stringify({
        "url": "https://www.instagram.com/chanz_sweet.052",
        "cursor": ""
    }, null, 2),
    'get_list_ig_user_stories': JSON.stringify({
        "url": "https://www.instagram.com/mt.cinn/",
        "raw": ""
    }, null, 2)
};

// --- Helper Functions for UI Updates ---
function showStatusMessage(message, isError = false) {
    overallStatusDiv.innerHTML = message; // Use innerHTML for potential strong tags
    overallStatusDiv.style.display = 'block';
    if (isError) {
        overallStatusDiv.style.backgroundColor = '#f8d7da'; // Light red
        overallStatusDiv.style.color = '#721c24'; // Dark red
    } else {
        overallStatusDiv.style.backgroundColor = '#e2f0e8'; // Light green
        overallStatusDiv.style.color = '#218838'; // Dark green
    }
}

function hideStatusMessages() {
    overallStatusDiv.style.display = 'none';
    multiUrlProgressDiv.style.display = 'none';
    multiUrlProgressDiv.innerHTML = '';
}

function updateUrlStatus(element, message, isError = false) {
    element.innerHTML = message;
    if (isError) {
        element.classList.add('error');
    } else {
        element.classList.remove('error');
    }
}

// Function to update API parameters textarea based on selected API
function updateApiParams() {
    const apiSelect = document.getElementById('apiSelect');
    const apiParamsTextarea = document.getElementById('apiParams');
    const selectedApi = apiSelect.value;
    apiParamsTextarea.value = defaultApiParams[selectedApi] || '{}'; // Set default or empty object
}

// Initialize params on page load
window.onload = updateApiParams;

// Renamed and refactored from old makeApiCall
async function fetchApiDataForSingleUrl(apiName, apiParams, urlStatusElement = null) {
    let allResultsLocal = [];
    let nextCursor = null;
    let currentPage = 0; // Initialize currentPage here

    let params = { ...apiParams }; // Create a mutable copy of params

    do {
        if (nextCursor) {
            params.cursor = nextCursor;
        } else {
            // For the very first request, ensure cursor is empty if not provided in initial params
            if (!params.cursor) params.cursor = "";
        }

        currentPage++; // Increment currentPage for each request
        const statusMessage = `Đang tải trang ${currentPage} từ URL: <strong>${params.url}</strong>...`;
        if (urlStatusElement) {
            updateUrlStatus(urlStatusElement, statusMessage);
        } else {
            showStatusMessage(statusMessage);
        }

        try {
            const response = await fetch('http://localhost:3000/call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: clientId,
                    apiname: apiName,
                    apiparams: params
                })
            });
            const data = await response.json();

            if (data.error) {
                const errorMessage = `Lỗi API cho URL <strong>${params.url}</strong>: ${data.error}`;
                if (urlStatusElement) updateUrlStatus(urlStatusElement, errorMessage, true);
                else showStatusMessage(errorMessage, true);
                console.error('API Error:', data.error);
                nextCursor = null; // Stop fetching
                break; // Exit loop on error
            }

            if (data.result && Array.isArray(data.result)) {
                // Get username for the current URL
                const currentUsername = getUsernameFromUrl(params.url);

                const resultsWithContext = data.result.map(item => ({
                    ...item,
                    originalUrl: params.url, // Keep originalUrl for reference
                    username: currentUsername // Add username to each item
                }));
                allResultsLocal = allResultsLocal.concat(resultsWithContext);

                let newCursor = null;
                if (data.result.length > 0) {
                    const lastItem = data.result[data.result.length - 1];
                    if (lastItem && lastItem.cursor && lastItem.cursor !== '' && lastItem.cursor !== 'None') {
                        newCursor = lastItem.cursor;
                    }
                }
                nextCursor = newCursor;
            } else {
                const errorMessage = `Phản hồi API không mong muốn cho URL <strong>${params.url}</strong>.`;
                if (urlStatusElement) updateUrlStatus(urlStatusElement, errorMessage, true);
                else showStatusMessage(errorMessage, true);
                console.error('Unexpected API response format:', data);
                nextCursor = null; // Stop fetching
            }

            // Small delay between pages to prevent overwhelming the server/API
            if (nextCursor) {
                await sleep(500);
            }

        } catch (error) {
            const errorMessage = `Lỗi Fetch cho URL <strong>${params.url}</strong>: ${error.message}`;
            if (urlStatusElement) updateUrlStatus(urlStatusElement, errorMessage, true);
            else showStatusMessage(errorMessage, true);
            console.error('Fetch error:', error);
            nextCursor = null; // Stop fetching
            break; // Exit loop on error
        }
    } while (nextCursor);

    return { data: allResultsLocal, pagesLoaded: currentPage }; // Return both data and pages loaded
}

async function displayResults(results, apiName) {
    resultsDiv.innerHTML = ''; // Clear previous results
    document.getElementById('downloadAllBtn').style.display = 'none';

    if (results.length === 0) {
        resultsDiv.textContent = 'Không tìm thấy kết quả nào.';
        return;
    }

    // Pass `results` and `apiName` to specific render functions
    if (apiName === 'get_list_fb_user_photos') {
        renderFbUserPhotos(results);
    } else if (apiName === 'get_list_fb_user_reels') {
        renderFbUserReels(results);
    } else if (apiName === 'get_list_ig_post') {
        renderIgPost(results);
    } else if (apiName === 'get_list_ig_user_stories') {
        renderIgUserStories(results);
    } else {
        renderGenericResults(results);
    }

    // Show download button if there are results to display
    if (results.length > 0) {
        document.getElementById('downloadAllBtn').style.display = 'block';
    }
}

// --- Specific Render Functions ---

async function renderFbUserPhotos(results) {
    let savedList = [];
    try {
        const resp = await fetch('http://localhost:3000/saved-list');
        const data = await resp.json();
        savedList = data.list || [];
    } catch (e) { console.error("Error fetching saved list:", e); }

    resultsDiv.innerHTML = results.map(item => {
        if (item.image || item.accessibility_caption) {
            // Use item.username directly which was added during fetchApiDataForSingleUrl
            const isSaved = savedList.some(e => e.username === item.username && e.id === item.id);
            return `
                <div class="result-item">
                    <img src="${item.image}" alt="${item.accessibility_caption || 'Image'}">
                    <p>Chú thích: ${item.accessibility_caption || '(Không có chú thích)'}</p>
                    <span style="color:${isSaved ? 'green' : 'red'};font-weight:bold;">${isSaved ? 'Đã lưu' : 'Chưa lưu'}</span>
                </div>
            `;
        }
        return '';
    }).join('');
}

function renderFbUserReels(results) {
    // For reels, we might not have a saved_images.json entry directly for reels yet
    // So the "Saved/Not saved" status might not be applicable directly.
    // If you want to track reels, you'll need to extend the saved_images.json structure
    // or add a new saved_reels.json. For now, I'll omit the saved status in render.
    resultsDiv.innerHTML = results.map(item => {
        if (item.video || item.id) {
            return `
                <div class="result-item">
                    <video src="${item.video?.play_uri || ''}" controls style="max-width:180px;max-height:180px;"></video>
                    <p>ID: ${item.id || ''}</p>
                    <p>Tiêu đề: ${item.title || '(Không có tiêu đề)'}</p>
                    <p>Lượt xem: ${item.view_count || 'N/A'}</p>
                </div>
            `;
        }
        return '';
    }).join('');
}

async function renderIgPost(results) {
    let savedList = [];
    try {
        const resp = await fetch('http://localhost:3000/saved-list');
        const data = await resp.json();
        savedList = data.list || [];
    } catch (e) { console.error("Error fetching saved list:", e); }

    resultsDiv.innerHTML = `<div style="display:flex;gap:20px;flex-wrap:wrap;">` +
        results.map(item => {
            // Use item.username directly which was added during fetchApiDataForSingleUrl
            const isSaved = savedList.some(e => e.username === item.username && e.id === item.id);
            const date = new Date(item.created_at * 1000); // Instagram timestamp is in seconds
            const formattedDate = date.toLocaleString();
            let mediaContent = '';
            if (item.video) {
                mediaContent = `<video src="${item.video}" controls style="max-width:180px;max-height:180px;"></video>`;
            } else if (item.image) {
                mediaContent = `<img src="${item.image}" alt="Post image" style="max-width:180px;max-height:180px;">`;
            }
            let carouselContent = '';
            if (item.carousel && item.carousel.length > 0) {
                carouselContent = `<div class="carousel">` +
                    item.carousel.map(carouselItem => {
                        if (carouselItem.video) {
                            return `<video src="${carouselItem.video}" controls style="max-width:90px;max-height:90px;"></video>`;
                        } else if (carouselItem.image) {
                            return `<img src="${carouselItem.image}" alt="Carousel image" style="max-width:90px;max-height:90px;">`;
                        }
                        return '';
                    }).join('') +
                    `</div>`;
            }
            return `
                <div class="result-item" style="flex-direction:column;align-items:flex-start;min-width:220px;max-width:220px;">
                    <div style="margin-bottom:8px;">${mediaContent}${carouselContent}</div>
                    <div style="margin-bottom:4px;"><b>Post ID:</b> ${item.post_id || item.id}</div>
                    <div style="margin-bottom:4px;"><b>Caption:</b> ${item.caption || '(No caption)'}</div>
                    <div style="margin-bottom:4px;"><b>Created:</b> ${formattedDate}</div>
                    <div style="margin-bottom:4px;"><b>Likes:</b> ${item.like_count !== undefined ? item.like_count : 'N/A'}</div>
                    <div style="margin-bottom:4px;"><b>Comments:</b> ${item.comment_count !== undefined ? item.comment_count : 'N/A'}</div>
                    <span style="color:${isSaved ? 'green' : 'red'};font-weight:bold;">${isSaved ? 'Đã tải về' : 'Chưa tải'}</span>
                </div>
            `;
        }).join('') + `</div>`;
}

function renderGenericResults(results) {
    resultsDiv.innerHTML = results.map(item => `
        <div class="result-item">
            <pre>${JSON.stringify(item, null, 2)}</pre>
        </div>
    `).join('');
}

// --- Thêm hàm render cho IG Stories ---
async function renderIgUserStories(results) {
    let savedList = [];
    try {
        const resp = await fetch('http://localhost:3000/saved-list');
        const data = await resp.json();
        savedList = data.list || [];
    } catch (e) { console.error("Error fetching saved list for stories:", e); }

    resultsDiv.innerHTML = `<div style="display:flex;gap:20px;flex-wrap:wrap;">` +
        results.map(item => {
            const isSaved = savedList.some(e => e.username === item.username && e.id === item.id);
            const date = item.taken_at ? new Date(item.taken_at) : null;
            const expDate = item.expiring_at ? new Date(item.expiring_at) : null;
            let mediaContent = '';
            if (item.video) {
                mediaContent = `<video src="${item.video}" controls style="max-width:180px;max-height:180px;"></video>`;
            } else if (item.image) {
                mediaContent = `<img src="${item.image}" alt="Story image" style="max-width:180px;max-height:180px;">`;
            }
            return `
                <div class="result-item" style="flex-direction:column;align-items:flex-start;min-width:220px;max-width:220px;">
                    <div style="margin-bottom:8px;">${mediaContent}</div>
                    <div style="margin-bottom:4px;"><b>Story ID:</b> ${item.id || item.pk}</div>
                    <div style="margin-bottom:4px;"><b>Thời gian đăng:</b> ${date ? date.toLocaleString() : ''}</div>
                    <div style="margin-bottom:4px;"><b>Hết hạn:</b> ${expDate ? expDate.toLocaleString() : ''}</div>
                    <div style="margin-bottom:4px;"><b>Thời lượng video:</b> ${item.video_duration ? item.video_duration + 's' : 'N/A'}</div>
                    <div style="margin-bottom:4px;"><b>Nhạc:</b> ${item.music || '(Không có)'}</div>
                    <span style="color:${isSaved ? 'green' : 'red'};font-weight:bold;">${isSaved ? 'Đã tải về' : 'Chưa tải'}</span>
                </div>
            `;
        }).join('') + `</div>`;
}

// --- Thêm hàm shuffle array ---
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

async function downloadAll() {
    const downloadBtn = document.getElementById('downloadAllBtn');
    const apiSelect = document.getElementById('apiSelect');
    const selectedApi = apiSelect.value;

    downloadBtn.disabled = true;
    const originalButtonText = downloadBtn.textContent;
    downloadBtn.textContent = 'Đang gửi yêu cầu tải về server...';
    showStatusMessage('Đang gửi yêu cầu tải về server...');

    // No need to derive originalUrl from apiParams.value here for server side,
    // as each item in allResults already has its own originalUrl and username.

    // --- NEW LOGIC FOR CHECKING SAVED STATUS BEFORE DOWNLOADING ---
    let savedList = [];
    try {
        const resp = await fetch('http://localhost:3000/saved-list');
        const data = await resp.json();
        savedList = data.list || [];
    } catch (e) {
        console.error("Error fetching saved list for download check:", e);
        showStatusMessage('❌ Lỗi khi kiểm tra trạng thái lưu trữ: ' + e.message, true);
        downloadBtn.disabled = false;
        downloadBtn.textContent = originalButtonText;
        return; // Stop if savedList cannot be fetched
    }

    // Filter items to download: only those that are NOT already saved
    const itemsToDownload = allResults.filter(item => {
        // Use item.username which was added when fetching data
        const isSaved = savedList.some(e => e.username === item.username && e.id === item.id);
        return !isSaved; // Return items that are NOT saved
    });

    if (itemsToDownload.length === 0) {
        showStatusMessage('✅ Tất cả ảnh/video đã được lưu, không có ảnh mới để tải về!', false);
        downloadBtn.disabled = false;
        downloadBtn.textContent = originalButtonText;
        // Re-display results to ensure status is correctly shown after check
        await displayResults(allResults, selectedApi);
        return; // Stop here, no new items to download
    }
    // --- END NEW LOGIC ---

    try {
        const response = await fetch('http://localhost:3000/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // Send ONLY the items that need to be downloaded
            // Each item now correctly includes `username` and `originalUrl`
            body: JSON.stringify({ results: itemsToDownload, apiName: selectedApi })
        });

        const data = await response.json();

        if (response.ok) {
            showStatusMessage('✅ Server báo cáo: ' + data.message, false);
            // After successful download request, re-display results to update saved status
            await displayResults(allResults, selectedApi); // Re-render ALL original results to update their status
        } else {
            showStatusMessage('❌ Server báo cáo lỗi: ' + (data.error || 'Unknown error'), true);
        }

    } catch (error) {
        showStatusMessage('❌ Lỗi khi gửi yêu cầu tải về server: ' + error.message, true);
        console.error('Download request error:', error);
    } finally {
        downloadBtn.disabled = false;
        downloadBtn.textContent = originalButtonText;
    }
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function makeApiCallMultiUrl() {
    hideStatusMessages(); // Hide previous status messages
    resultsDiv.innerHTML = ''; // Clear main results display
    document.getElementById('downloadAllBtn').style.display = 'none';
    allResults = []; // Clear allResults for a new multi-URL call
    multiUrlProgressDiv.style.display = 'block'; // Show multi-URL progress area
    multiUrlProgressDiv.innerHTML = ''; // Clear previous multi-URL progress

    let apiParamsRaw = document.getElementById('apiParams').value;
    let apiParamsObj;
    try {
        apiParamsObj = JSON.parse(apiParamsRaw);
    } catch (e) {
        showStatusMessage('Lỗi: API Parameters không phải JSON hợp lệ!', true);
        return;
    }

    let urlField = apiParamsObj.url;
    if (!urlField) {
        showStatusMessage('Lỗi: Không tìm thấy trường "url" trong API Parameters!', true);
        return;
    }

    let urlList = urlField.split(/(?:,\s*|\n)+/).map(u => u.trim()).filter(Boolean); // Split by comma or newline
    if (urlList.length === 0) {
        showStatusMessage('Lỗi: Không có URL nào!', true);
        return;
    }

    const apiName = document.getElementById('apiSelect').value;
    const report = [];
    let startTime = Date.now();

    // --- SHUFFLE LOGIC & SAVE SHUFFLED ORDER ---
    let shuffledUrlList = urlList;
    if (apiName === 'get_list_ig_user_stories') {
        shuffledUrlList = shuffleArray([...urlList]);
        // Gửi danh sách đã shuffle lên server để lưu lại
        try {
            await fetch('http://localhost:3000/save-shuffled-urls', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apiName,
                    urls: shuffledUrlList,
                    timestamp: new Date().toISOString()
                })
            });
        } catch (e) {
            console.error('Lỗi khi lưu thứ tự URL đã shuffle:', e);
        }
    }

    for (let i = 0; i < shuffledUrlList.length; i++) {
        let url = shuffledUrlList[i];
        // Ensure cursor is reset for each new URL, and original URL is passed
        let currentApiParams = { ...apiParamsObj, url: url, cursor: "" };

        const urlStatusItem = document.createElement('div');
        urlStatusItem.classList.add('url-status-item');
        multiUrlProgressDiv.appendChild(urlStatusItem);

        updateUrlStatus(urlStatusItem, `Đang xử lý URL ${i + 1}/${shuffledUrlList.length}: <strong>${url}</strong>`);
        showStatusMessage(`Đang xử lý URL ${i + 1} / ${shuffledUrlList.length} (<strong>${url}</strong>)...`);

        let startUrlTime = Date.now();
        // Updated: Destructure the returned object to get both data and pagesLoaded
        let { data: fetchedData, pagesLoaded } = await fetchApiDataForSingleUrl(apiName, currentApiParams, urlStatusItem);
        allResults = allResults.concat(fetchedData); // Add fetched data to global allResults

        let endUrlTime = Date.now();
        let durationUrl = endUrlTime - startUrlTime;
        let durationUrlStr = new Date(durationUrl).toISOString().substr(11, 8);

        // Get username for the current URL being processed to include in the report
        let usernameForReport = getUsernameFromUrl(url);

        // Fetch saved list after processing each URL to get updated saved status for the report
        let savedListForReport = [];
        try {
            const resp = await fetch('http://localhost:3000/saved-list');
            const data = await resp.json();
            savedListForReport = data.list || [];
        } catch (e) { console.error("Error fetching saved list for report:", e); }

        const totalItemsForUrl = fetchedData.length;
        const haveItemsForUrl = fetchedData.filter(item => {
            // Use item.username which is now guaranteed to exist
            return savedListForReport.some(e => e.username === item.username && e.id === item.id);
        }).length;
        const noHaveItemsForUrl = totalItemsForUrl - haveItemsForUrl;

        const reportData = {
            apiName,
            report: [{
                url: url,
                username: usernameForReport,
                total: totalItemsForUrl,
                have: haveItemsForUrl,
                nohave: noHaveItemsForUrl,
                time: durationUrlStr,
                pages: pagesLoaded
            }],
            timestamp: new Date().toISOString()
        };

        // Lưu ngay dữ liệu của URL hiện tại vào file
        try {
            await fetch('http://localhost:3000/save-ig-user-stories-report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reportData)
            });
        } catch (e) {
            console.error('Lỗi khi lưu report cho URL:', url, e);
        }

        report.push(reportData.report[0]); // Add to local report array for display

        const finalUrlStatus = `Hoàn thành URL ${i + 1}/${shuffledUrlList.length}: <strong>${url}</strong><br>` +
            `Tổng: ${totalItemsForUrl}, Đã tải: ${haveItemsForUrl}, Chưa tải: ${noHaveItemsForUrl}<br>` +
            `Số trang đã tải: ${pagesLoaded}<br>` +
            `Thời gian tải: ${durationUrlStr}`;
        updateUrlStatus(urlStatusItem, finalUrlStatus);

        if (i < shuffledUrlList.length - 1) {
            showStatusMessage(`Đã hoàn thành URL ${i + 1}/${shuffledUrlList.length}. Đang chờ 3 giây trước khi xử lý URL tiếp theo...`);
            await sleep(3000); // Wait 3 seconds
        }
    }

    let endTime = Date.now();
    let duration = endTime - startTime;
    let durationStr = new Date(duration).toISOString().substr(11, 8);

    let reportHtml = '<h3>Kết quả tổng hợp tất cả URLs:</h3>';
    report.forEach(r => {
        reportHtml += `<div style="margin-bottom:10px;"><b>URL:</b> <a href="${r.url}" target="_blank">${r.url}</a><br>` +
            `<b>User name:</b> ${r.username || 'N/A'}<br>` +
            `<b>Tổng số mục:</b> ${r.total}<br>` +
            `<b>Đã tải về trên thiết bị:</b> ${r.have}<br>` +
            `<b>Chưa tải về trên thiết bị:</b> ${r.nohave}<br>` +
            `<b>Số trang đã tải:</b> ${r.pages}<br>` +
            `<b>Thời gian tải:</b> ${r.time}</div>`;
    });
    reportHtml += `<b>Tổng thời gian xử lý:</b> ${durationStr}`;
    multiUrlProgressDiv.innerHTML = reportHtml; // Display final report in multiUrlProgressDiv

    showStatusMessage(`✅ Đã hoàn thành xử lý tất cả ${shuffledUrlList.length} URL trong ${durationStr}.`);
    document.getElementById('downloadAllBtn').style.display = 'block'; // Show download button after all URLs are processed
    await displayResults(allResults, apiName); // Finally, display all aggregated results
}

// Helper to extract username from URL for saved status checks and sending to server
function getUsernameFromUrl(url) {
    if (!url) return 'unknown_user'; // Default to unknown_user
    try {
        const urlObj = new URL(url);
        if (urlObj.hostname.includes('facebook.com')) {
            const pathParts = urlObj.pathname.split('/').filter(part => part);
            if (pathParts.length > 0) {
                if (pathParts[0] === 'profile.php' && urlObj.searchParams.has('id')) {
                    return urlObj.searchParams.get('id');
                } else if (pathParts[0] !== 'photo.php' && pathParts[0] !== 'story.php') { // Exclude common file paths
                    return pathParts[0];
                }
            }
        } else if (urlObj.hostname.includes('instagram.com')) {
            let path = urlObj.pathname.split('/').filter(part => part)[0];
            if (path && path.endsWith('/')) path = path.slice(0, -1);
            return path;
        }
    } catch (e) {
        console.error("Error extracting username from URL:", url, e);
    }
    return 'unknown_user'; // Default username if extraction fails
}