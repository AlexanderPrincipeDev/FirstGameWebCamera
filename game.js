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
let targets = [];
let particles = [];
let handLandmarks = null;
let lastShotTime = 0;
const SHOT_COOLDOWN = 500; // ms

// Audio effects (using simple oscillator for now, or placeholders)
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
        this.y = Math.random() * (canvasElement.height - 200) + 100;
        this.speed = (2 + Math.random() * 2 + (level * 0.5));
        this.direction = Math.random() > 0.5 ? 1 : -1;
        this.x = this.direction === 1 ? -this.radius : canvasElement.width + this.radius;
        this.color = `hsl(${Math.random() * 360}, 70%, 50%)`;
        this.markedForDeletion = false;
        this.type = Math.random() > 0.8 ? 'bonus' : 'normal'; // 20% chance for bonus
    }

    update() {
        this.x += this.speed * this.direction;
        
        // Sine wave movement
        this.y += Math.sin(this.x / 100) * 2;

        if ((this.direction === 1 && this.x > canvasElement.width + this.radius) || 
            (this.direction === -1 && this.x < -this.radius)) {
            this.markedForDeletion = true;
        }
    }

    draw() {
        canvasCtx.beginPath();
        canvasCtx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        canvasCtx.fillStyle = this.color;
        canvasCtx.fill();
        
        // Eye (to make it look like a bird/duck face)
        canvasCtx.fillStyle = 'white';
        canvasCtx.beginPath();
        canvasCtx.arc(this.x + (10 * this.direction), this.y - 10, 8, 0, Math.PI * 2);
        canvasCtx.fill();
        canvasCtx.fillStyle = 'black';
        canvasCtx.beginPath();
        canvasCtx.arc(this.x + (12 * this.direction), this.y - 10, 3, 0, Math.PI * 2);
        canvasCtx.fill();
        
        // Beak
        canvasCtx.fillStyle = 'orange';
        canvasCtx.beginPath();
        canvasCtx.moveTo(this.x + (20 * this.direction), this.y - 5);
        canvasCtx.lineTo(this.x + (35 * this.direction), this.y);
        canvasCtx.lineTo(this.x + (20 * this.direction), this.y + 5);
        canvasCtx.fill();
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
const hands = new Hands({locateFile: (file) => {
    return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
}});

hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7
});

hands.onResults(onResults);

const camera = new Camera(videoElement, {
    onFrame: async () => {
        await hands.send({image: videoElement});
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

function detectShot(landmarks) {
    // Landmark 4 is thumb tip, 8 is index tip
    const thumbTip = landmarks[4];
    const indexPip = landmarks[6]; // Second joint of index finger
    
    // Distance between thumb tip and index PIP
    const distance = Math.sqrt(
        Math.pow(thumbTip.x - indexPip.x, 2) + 
        Math.pow(thumbTip.y - indexPip.y, 2)
    );
    
    // Threshold for "pinch" or "trigger"
    if (distance < 0.05) { // Needs tuning based on normalized coordinates
        const currentTime = Date.now();
        if (currentTime - lastShotTime > SHOT_COOLDOWN) {
            shoot(landmarks);
            lastShotTime = currentTime;
        }
        return true;
    }
    return false;
}

function shoot(landmarks) {
    playSound('shoot');
    
    // Calculate cursor position (Index Tip)
    // Note: mirror transformation is handled in CSS/Canvas scaling context usually, 
    // but here landmarks are normalized 0-1. 
    // Since we CSS transform scaleX(-1) the canvas, visual x=0 is left. 
    // Landmarks x=0 is left of camera image. 
    // If user's right hand moves right (in real world), it moves left in camera frame (x approaches 0).
    // On mirrored canvas (flipped X), x=0 (left) should correspond to camera x=1 (right).
    // Let's simplify: With scaleX(-1) on canvas, drawing at x=100 draws at width-100 visually.
    // It's often easier to flip coordinate here and use normal canvas.
    
    // Actually, simplest way with MediaPipe selfie mode logic:
    // x = 1 - landmarks[8].x (if we weren't flipping canvas with CSS)
    // But since we flip canvas with CSS, we draw normally? 
    // Let's try drawing at (landmarks[8].x * width, landmarks[8].y * height).
    // If CSS flips it, then x=0.1 (left side of camera) becomes right side of screen. That's correct for mirror.
    
    const cursorX = landmarks[8].x * canvasElement.width;
    const cursorY = landmarks[8].y * canvasElement.height;
    
    // Visual flash
    canvasCtx.fillStyle = 'rgba(255, 255, 0, 0.5)';
    canvasCtx.beginPath();
    canvasCtx.arc(cursorX, cursorY, 20, 0, Math.PI * 2);
    canvasCtx.fill();

    // Check collision
    for (let i = targets.length - 1; i >= 0; i--) {
        const t = targets[i];
        const dist = Math.sqrt(Math.pow(t.x - cursorX, 2) + Math.pow(t.y - cursorY, 2));
        
        if (dist < t.radius + 10) { // Hit!
            targets.splice(i, 1);
            score += 10;
            scoreElement.innerText = score;
            playSound('hit');
            
            // Create explosion
            for(let j=0; j<10; j++){
                particles.push(new Particle(t.x, t.y, t.color));
            }
            
            if (score % 50 === 0) {
                level++;
                levelElement.innerText = level;
            }
        }
    }
}

function gameLoop() {
    if (!isGameRunning) return;

    // Clear canvas
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    // Draw background (optional sky gradient)
    // canvasCtx.fillStyle = '#87CEEB';
    // canvasCtx.fillRect(0,0, canvasElement.width, canvasElement.height);

    // Update and Draw targets
    if (Math.random() < 0.02 + (level * 0.005)) { // Spawn rate
        targets.push(new Target());
    }

    targets.forEach((target, index) => {
        target.update();
        target.draw();
        if (target.markedForDeletion) {
            targets.splice(index, 1);
        }
    });
    
    // Update Particles
    particles.forEach((p, index) => {
        p.update();
        p.draw();
        if (p.life <= 0) particles.splice(index, 1);
    });

    // Handle Hand Tracking
    if (handLandmarks) {
        // Draw Cursor (Crosshair) at Index Tip (8)
        const x = handLandmarks[8].x * canvasElement.width;
        const y = handLandmarks[8].y * canvasElement.height;

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
        
        // Detect Shot
        detectShot(handLandmarks);
    }

    requestAnimationFrame(gameLoop);
}

function startGame() {
    isGameRunning = true;
    score = 0;
    level = 1;
    targets = [];
    particles = [];
    scoreElement.innerText = score;
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

document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('restart-btn').addEventListener('click', startGame);
