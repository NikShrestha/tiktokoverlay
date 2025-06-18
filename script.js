document.addEventListener('DOMContentLoaded', () => {
    // --- ELEMENTS & SOUNDS ---
    const wrapper = document.getElementById('slider-wrapper');
    const track = document.getElementById('slider-track');
    const startSound = document.getElementById('start-sound');
    const tickSound = document.getElementById('tick-sound');
    const winSound = document.getElementById('win-sound');

    // --- STATE & CONFIG ---
    let tier1_prizes = [];
    let tier2_prizes = [];
    const TOTAL_ITEM_WIDTH = 170; // From CSS: 150px width + (10px margin * 2)
    const REPEATS = 20;
    let isSpinning = false;
    let ws;

    function populateSlider(tier) {
        track.innerHTML = '';
        const source_prizes = (tier === 2) ? tier2_prizes : tier1_prizes;
        if (source_prizes.length === 0) {
            console.error("Prizes not loaded, cannot populate slider for Tier", tier);
            return;
        }

        let fullPrizeList = [];
        let lastPrizeId = null;

        for (let i = 0; i < REPEATS * source_prizes.length; i++) {
            let availablePrizes = source_prizes.filter(p => p.id !== lastPrizeId);
            if (availablePrizes.length === 0) availablePrizes = source_prizes;
            const nextPrize = availablePrizes[Math.floor(Math.random() * availablePrizes.length)];
            fullPrizeList.push(nextPrize);
            lastPrizeId = nextPrize.id;
        }

        fullPrizeList.forEach(prize => {
            const item = document.createElement('div');
            item.className = `slider-item color-${prize.color || 'blue'}`;
            item.dataset.prizeId = prize.id;
            if (prize.icon_path) {
                const iconEl = document.createElement('img');
                iconEl.className = 'item-icon';
                iconEl.src = prize.icon_path;
                item.appendChild(iconEl);
            }
            if (prize.display_text) {
                const textEl = document.createElement('div');
                textEl.className = 'item-text';
                textEl.textContent = prize.display_text;
                item.appendChild(textEl);
            }
            track.appendChild(item);
        });
    }

    async function startAnimationSequence(tier) {
        const current_prizes = (tier === 2) ? tier2_prizes : tier1_prizes;
        if (isSpinning || current_prizes.length === 0) {
            console.log("Spin blocked: already spinning or no prizes loaded for tier", tier);
            if (ws && ws.readyState === WebSocket.OPEN) {
                 ws.send(JSON.stringify({ type: 'animation_finished' })); // Free up the queue
            }
            return;
        }
        isSpinning = true;
        
        populateSlider(tier);
        
        wrapper.classList.remove('hidden');
        startSound.play();
        await new Promise(r => setTimeout(r, 600));

        track.style.transition = 'none';
        track.style.transform = 'translateX(0px)';
        await new Promise(r => setTimeout(r, 50));

        track.style.transition = 'transform 7s cubic-bezier(.15,.9,.32,1.05)';
        
        const targetItemIndex = Math.floor(Math.random() * current_prizes.length) + (current_prizes.length * (REPEATS - 5));
        const stopPosition = (targetItemIndex * TOTAL_ITEM_WIDTH) + (TOTAL_ITEM_WIDTH / 2) - (wrapper.offsetWidth / 2);
        track.style.transform = `translateX(-${stopPosition}px)`;

        const tickInterval = setInterval(() => tickSound.play(), 200);
        await new Promise(r => setTimeout(r, 7000));
        clearInterval(tickInterval);

        let finalWinnerElement = null;
        let minDistance = Infinity;
        const finalContainerCenter = wrapper.getBoundingClientRect().left + (wrapper.offsetWidth / 2);
        for (const item of track.children) {
            const itemRect = item.getBoundingClientRect();
            const distance = Math.abs(finalContainerCenter - (itemRect.left + itemRect.width / 2));
            if (distance < minDistance) { minDistance = distance; finalWinnerElement = item; }
        }
        const officialPrizeId = finalWinnerElement.dataset.prizeId;

        winSound.play();
        finalWinnerElement.style.transform = 'scale(1.15)';
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'spin_result', data: officialPrizeId }));
        }

        await new Promise(r => setTimeout(r, 4000));
        wrapper.classList.add('hidden');
        await new Promise(r => setTimeout(r, 600));
        
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'animation_finished' }));
        }
        isSpinning = false;
    }

    function connectWebSocket() {
        // --- THIS IS THE NEW, SMARTER LOGIC ---
        let ws_address;
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

        if (isLocal) {
            // If we are on localhost, connect directly without needing parameters.
            ws_address = 'ws://localhost:8765';
            console.log(`[WebSocket] Local environment detected. Connecting to: ${ws_address}`);
        } else {
            // If we are on a public server (like ngrok), use the URL parameter.
            const urlParams = new URLSearchParams(window.location.search);
            const wsHost = urlParams.get('wsHost');

            if (!wsHost) {
                const errorMsg = "ERROR: WebSocket Host not provided in URL. Add '?wsHost=YOUR_WEBSOCKET_TUNNEL_ADDRESS' to your OBS link.";
                console.error(errorMsg);
                document.body.innerHTML = `<div style="font-family: sans-serif; color: white; background: red; padding: 30px; font-size: 24px; text-align: center;">${errorMsg}</div>`;
                return; // Stop execution
            }
            // Public connections should be secure (wss://)
            ws_address = `wss://${wsHost}`;
            console.log(`[WebSocket] Public host detected. Connecting to: ${ws_address}`);
        }
        // --- END OF NEW LOGIC ---

        ws = new WebSocket(ws_address);

        ws.onopen = () => {
            console.log('✅ WebSocket Connected!');
        };

        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'config') {
                tier1_prizes = msg.data.tier1_prizes || [];
                tier2_prizes = msg.data.tier2_prizes || [];
                console.log('✅ Config loaded from backend!');
            } else if (msg.type === 'spin_command') {
                console.log("▶️ Received spin command! Starting animation for Tier", msg.tier);
                startAnimationSequence(msg.tier);
            }
        };

        ws.onclose = () => {
            console.log('❌ Disconnected. Retrying in 3 seconds...');
            setTimeout(connectWebSocket, 3000);
        };
        
        ws.onerror = (err) => {
            console.error("WebSocket Error:", err);
            ws.close(); // This will trigger the onclose event and the reconnect logic
        };
    }
    
    // Start the connection process
    connectWebSocket();
});