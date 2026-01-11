const videoElement = document.getElementById('input_video');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');

const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const loadingScreen = document.getElementById('loading');
const scoreElement = document.getElementById('score');
const finalScoreElement = document.getElementById('final-score');
const levelElement = document.getElementById('level');

let isGameRunning = false;
let score = 0;
let level = 1;
let lives = 3;
let targets = [];
let particles = [];
let powerups = [];
let handLandmarks = null;
let lastShotTime = 0;
let screenShake = 0;
const SHOT_COOLDOWN = 300;

// Smoothing variables
let smoothedX = 0;
let smoothedY = 0;
const SMOOTHING_FACTOR = 0.2; // Lower = smoother but more lag (0.1 - 0.3 is good)

// Audio effects
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

function playSound(type) {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    if (type === 'shoot') {
        oscillator.type = 'square';
        oscillator.frequency.setValueAtTime(400, audioCtx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.1);
    } else if (type === 'hit') {
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(600, audioCtx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.1);
    }
}

// Game Settings
function resizeCanvas() {
    canvasElement.width = window.innerWidth;
    canvasElement.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Target Class
class Target {
    constructor() {
        this.radius = 30 + Math.random() * 20;
        this.y = Math.random() * (canvasElement.height - 300) + 100;
        this.speed = (2 + Math.random() * 2 + (level * 0.5));
        this.direction = Math.random() > 0.5 ? 1 : -1;
        this.x = this.direction === 1 ? -this.radius : canvasElement.width + this.radius;
        this.markedForDeletion = false;

        // Enemy Types
        const rand = Math.random();
        if (rand < 0.1 && level > 2) this.type = 'fast';
        else if (rand < 0.2 && level > 1) this.type = 'zigzag';
        else if (rand < 0.3 && level > 3) this.type = 'diver';
        else this.type = 'normal';

        this.color = this.getTypeColor();
        this.angle = 0; // For zigzag/diver
    }

    getTypeColor() {
        switch (this.type) {
            case 'fast': return '#FF4081'; // Pink
            case 'zigzag': return '#7C4DFF'; // Purple
            case 'diver': return '#536DFE'; // Blue
            default: return `hsl(${Math.random() * 60 + 30}, 100%, 50%)`; // Yellow/Orange
        }
    }

    update() {
        this.x += this.speed * this.direction;
        this.angle += 0.05;

        // Type specific movement
        if (this.type === 'normal') {
            this.y += Math.sin(this.x / 100) * 2;
        } else if (this.type === 'zigzag') {
            this.y += Math.sin(this.angle * 5) * 5;
        } else if (this.type === 'diver') {
            if (Math.abs(this.x - canvasElement.width / 2) < 200) {
                this.y += 3; // Dive down in middle
            }
        } else if (this.type === 'fast') {
            this.x += (this.speed * 0.5) * this.direction; // Extra speed
        }

        if ((this.direction === 1 && this.x > canvasElement.width + this.radius) ||
            (this.direction === -1 && this.x < -this.radius)) {
            this.markedForDeletion = true;
            loseLife();
        }
    }

    draw() {
        canvasCtx.beginPath();
        canvasCtx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        canvasCtx.fillStyle = this.color;
        canvasCtx.fill();

        // Simple Eye
        canvasCtx.fillStyle = 'white';
        canvasCtx.beginPath();
        canvasCtx.arc(this.x + (10 * this.direction), this.y - 10, 8, 0, Math.PI * 2);
        canvasCtx.fill();
        canvasCtx.fillStyle = 'black';
        canvasCtx.beginPath();
        canvasCtx.arc(this.x + (12 * this.direction), this.y - 10, 3, 0, Math.PI * 2);
        canvasCtx.fill();
    }
}

class PowerUp {
    constructor() {
        this.x = Math.random() * (canvasElement.width - 100) + 50;
        this.y = canvasElement.height + 50;
        this.radius = 25;
        this.speedY = -2;
        this.type = 'nuke'; // Extendable
        this.markedForDeletion = false;
        this.color = '#00E676'; // Green
    }

    update() {
        this.y += this.speedY;
        if (this.y < -50) this.markedForDeletion = true;
    }

    draw() {
        canvasCtx.beginPath();
        canvasCtx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        canvasCtx.fillStyle = this.color;
        canvasCtx.fill();
        canvasCtx.fillStyle = 'white';
        canvasCtx.font = '20px Arial';
        canvasCtx.fillText("💣", this.x - 10, this.y + 7);
    }
}

// Particle Class for explosions
class Particle {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.size = Math.random() * 5 + 2;
        this.speedX = Math.random() * 6 - 3;
        this.speedY = Math.random() * 6 - 3;
        this.color = color;
        this.life = 1.0; // Opacity
    }
    update() {
        this.x += this.speedX;
        this.y += this.speedY;
        this.life -= 0.05;
    }
    draw() {
        canvasCtx.globalAlpha = this.life;
        canvasCtx.fillStyle = this.color;
        canvasCtx.beginPath();
        canvasCtx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        canvasCtx.fill();
        canvasCtx.globalAlpha = 1.0;
    }
}

// MediaPipe Setup
const hands = new Hands({
    locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
    }
});

hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7
});

hands.onResults(onResults);

const camera = new Camera(videoElement, {
    onFrame: async () => {
        await hands.send({ image: videoElement });
    },
    width: 1280,
    height: 720
});

function onResults(results) {
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        handLandmarks = results.multiHandLandmarks[0];
    } else {
        handLandmarks = null;
    }
}

// Helper: Linear Interpolation
function lerp(start, end, amt) {
    return (1 - amt) * start + amt * end;
}

// Helper: Calculate distance between two landmarks
function dist(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

function processInput(landmarks) {
    // 1. Update Cursor Position with Smoothing
    // Target is Index Finger Tip (8)
    const rawX = landmarks[8].x * canvasElement.width;
    const rawY = landmarks[8].y * canvasElement.height;

    // Initialize if first frame
    if (smoothedX === 0 && smoothedY === 0) {
        smoothedX = rawX;
        smoothedY = rawY;
    }

    smoothedX = lerp(smoothedX, rawX, SMOOTHING_FACTOR);
    smoothedY = lerp(smoothedY, rawY, SMOOTHING_FACTOR);

    // 2. Detect Shot (Ergonomic: Pinch or Fist)
    const pinchState = getPinchState(landmarks);

    // Visual Feedback: Show pinch strength ring
    drawPinchRing(smoothedX, smoothedY, pinchState.dist);

    if (pinchState.isPinching || isFist(landmarks)) {
        const currentTime = Date.now();
        if (currentTime - lastShotTime > SHOT_COOLDOWN) {
            shoot(smoothedX, smoothedY);
            lastShotTime = currentTime;
        }
    }
}

function getPinchState(landmarks) {
    // Thumb Tip (4) vs Index Tip (8)
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const distance = dist(thumbTip, indexTip);

    // Threshold: touch is usually < 0.05
    return {
        isPinching: distance < 0.05,
        dist: distance // Return distance for visual feedback
    };
}

function isFist(landmarks) {
    // Check if Middle(12), Ring(16), Pinky(20) TIPS are below their PIPs (curled)
    // AND Index(8) is also curled.
    // AND Thumb is close to other fingers (optional, but fist usually implies it)

    // Wrist
    const wrist = landmarks[0];

    function isCurled(tipIdx, pipIdx) {
        return dist(landmarks[tipIdx], wrist) < dist(landmarks[pipIdx], wrist);
    }

    // All fingers curled
    return isCurled(8, 6) && isCurled(12, 10) && isCurled(16, 14) && isCurled(20, 18);
}

function drawPinchRing(x, y, pinchDist) {
    // Draw a ring that shrinks as you pinch
    // Max radius 50, min radius 10 (when touching)
    // pinchDist usually 0.0 ~ 0.3
    const maxDist = 0.2;
    const normDist = Math.max(0, Math.min(1, pinchDist / maxDist)); // 0 = touching, 1 = open

    const radius = 10 + (normDist * 40);

    canvasCtx.strokeStyle = `rgba(255, 255, 255, ${1 - normDist})`; // Fades out when open
    canvasCtx.lineWidth = 2;
    canvasCtx.beginPath();
    canvasCtx.arc(x, y, radius, 0, Math.PI * 2);
    canvasCtx.stroke();
}

// Helper Functions
function loseLife() {
    lives--;
    updateLivesDisplay();
    playSound('hit'); // reused
    if (lives <= 0) {
        gameOver();
    }
}

function updateLivesDisplay() {
    // We can add a lives element to HTML or draw it. Drawing is easier for now or append to score
    document.getElementById('score-board').innerHTML = `Puntos: ${score} <br> ❤️ ${lives}`;
}

function nukeScreen() {
    targets.forEach(t => {
        score += 5;
        // Create explosion
        for (let j = 0; j < 10; j++) {
            particles.push(new Particle(t.x, t.y, t.color));
        }
    });
    targets = [];
    scoreElement.innerText = score;
    updateLivesDisplay();
    playSound('hit');

    // Intense shake
    screenShake = 20;
}

function shoot(x, y) {
    playSound('shoot');

    // Visual flash
    canvasCtx.fillStyle = 'rgba(255, 255, 0, 0.5)';
    canvasCtx.beginPath();
    canvasCtx.arc(x, y, 20, 0, Math.PI * 2);
    canvasCtx.fill();

    screenShake = 5;

    // Check collision with Targets
    for (let i = targets.length - 1; i >= 0; i--) {
        const t = targets[i];
        const distance = Math.sqrt(Math.pow(t.x - x, 2) + Math.pow(t.y - y, 2));

        if (distance < t.radius + 15) { // Hit!
            targets.splice(i, 1);
            score += 10;
            // scoreElement.innerText = score; // Handled in updateLivesDisplay
            updateLivesDisplay();
            playSound('hit');

            // Create explosion
            for (let j = 0; j < 10; j++) {
                particles.push(new Particle(t.x, t.y, t.color));
            }

            if (score % 50 === 0) {
                level++;
                levelElement.innerText = level;
            }
        }
    }

    // Check Powerups
    for (let i = powerups.length - 1; i >= 0; i--) {
        const p = powerups[i];
        const distance = Math.sqrt(Math.pow(p.x - x, 2) + Math.pow(p.y - y, 2));
        if (distance < p.radius + 15) {
            powerups.splice(i, 1);
            if (p.type === 'nuke') nukeScreen();
        }
    }
}

function gameLoop() {
    if (!isGameRunning) return;

    // Clear canvas
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    // Screen Shake
    if (screenShake > 0) {
        const shakeX = (Math.random() - 0.5) * screenShake;
        const shakeY = (Math.random() - 0.5) * screenShake;
        canvasCtx.save();
        canvasCtx.translate(shakeX, shakeY);
        screenShake *= 0.9;
        if (screenShake < 0.5) screenShake = 0;
    }

    // Spawn Targets
    if (Math.random() < 0.02 + (level * 0.005)) {
        targets.push(new Target());
    }

    // Spawn Powerups
    if (Math.random() < 0.002) { // Rare
        powerups.push(new PowerUp());
    }

    targets.forEach((target, index) => {
        target.update();
        target.draw();
        if (target.markedForDeletion) {
            targets.splice(index, 1);
            // logic for escaping handled in update()
        }
    });

    powerups.forEach((p, index) => {
        p.update();
        p.draw();
        if (p.markedForDeletion) powerups.splice(index, 1);
    });

    // Update Particles
    particles.forEach((p, index) => {
        p.update();
        p.draw();
        if (p.life <= 0) particles.splice(index, 1);
    });

    if (screenShake > 0) canvasCtx.restore();

    // Handle Hand Tracking
    if (handLandmarks) {
        processInput(handLandmarks);

        // Draw Cursor (Crosshair) at Smoothed Position
        const x = smoothedX;
        const y = smoothedY;

        // Draw crosshair
        canvasCtx.strokeStyle = '#00FF00';
        canvasCtx.lineWidth = 3;
        canvasCtx.beginPath();
        canvasCtx.moveTo(x - 20, y);
        canvasCtx.lineTo(x + 20, y);
        canvasCtx.moveTo(x, y - 20);
        canvasCtx.lineTo(x, y + 20);
        canvasCtx.stroke();

        canvasCtx.beginPath();
        canvasCtx.arc(x, y, 15, 0, Math.PI * 2);
        canvasCtx.stroke();
    }

    requestAnimationFrame(gameLoop);
}

function startGame() {
    isGameRunning = true;
    score = 0;
    level = 1;
    lives = 3; // Reset lives
    targets = [];
    particles = [];
    powerups = [];

    updateLivesDisplay();
    levelElement.innerText = level;

    startScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');

    loadingScreen.classList.remove('hidden');

    camera.start()
        .then(() => {
            loadingScreen.classList.add('hidden');
            gameLoop();
        })
        .catch(err => {
            console.error(err);
            alert("Error al acceder a la cámara. Por favor asegúrate de dar permisos.");
        });
}

function gameOver() {
    isGameRunning = false;
    finalScoreElement.innerText = score;
    gameOverScreen.classList.remove('hidden');
}

document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('restart-btn').addEventListener('click', startGame);
