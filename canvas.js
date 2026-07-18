const canvasElement = document.getElementById("canvas");
const canvasContainer = canvasElement.parentElement;
const canvasContext = canvasElement.getContext("2d");

const DEVICE_PIXEL_RATIO = window.devicePixelRatio || 1;
const FRICTION = 0.99;
// const GRAVITY = 0.08;

const fireworkSound = new Audio("./audio/firework.wav");
fireworkSound.preload = "auto";
fireworkSound.volume = 0.35;

const resizeCanvas = () => {
  const rect = canvasContainer.getBoundingClientRect();

  canvasElement.width = rect.width * DEVICE_PIXEL_RATIO;
  canvasElement.height = rect.height * DEVICE_PIXEL_RATIO;

  canvasElement.style.width = `${rect.width}px`;
  canvasElement.style.height = `${rect.height}px`;

  canvasContext.setTransform(
    DEVICE_PIXEL_RATIO,
    0,
    0,
    DEVICE_PIXEL_RATIO,
    0,
    0,
  );
  canvasContext.fillStyle = "rgba(0, 0, 0, 0.1)";
};

const resizeObserver = new ResizeObserver(() => {
  resizeCanvas();
});

resizeObserver.observe(canvasContainer);

window.addEventListener("resize", resizeCanvas);

const particlesArray = [];

class Particle {
  constructor(position, velocity, radius, color) {
    this.position = position;
    this.velocity = velocity;
    this.radius = radius;
    this.color = color;

    this.alpha = 1;
    this.lifeTime = 100;
  }

  draw = () => {
    const { xPosition, yPosition } = this.position;
    const startAngle = 0;
    const endAngle = Math.PI * 2;

    canvasContext.save();
    canvasContext.globalAlpha = this.alpha;
    canvasContext.beginPath();
    canvasContext.arc(
      xPosition,
      yPosition,
      this.radius,
      startAngle,
      endAngle,
      false,
    );
    canvasContext.fillStyle = this.color;
    canvasContext.fill();
    canvasContext.restore();
  };

  update = () => {
    this.draw();

    this.lifeTime--;

    this.velocity = {
      xVelocity: this.velocity.xVelocity * FRICTION,
      yVelocity: this.velocity.yVelocity * FRICTION,
    };

    this.position = {
      xPosition: this.position.xPosition + this.velocity.xVelocity,
      yPosition: this.position.yPosition + this.velocity.yVelocity,
    };

    this.radius *= 0.99; // gradually shrink
    this.alpha *= 0.99; // gradually fade
  };
}

let animationId = undefined;

function initialize() {
  canvasContext.fillStyle = "rgba(0, 0, 0, 0.1)";
  canvasContext.fillRect(0, 0, canvasElement.width, canvasElement.height);

  for (let i = particlesArray.length - 1; i >= 0; i--) {
    particlesArray[i].update();

    if (particlesArray[i].radius <= 0.2 || particlesArray[i].alpha <= 0.02) {
      particlesArray.splice(i, 1);
    }
  }

  animationId = requestAnimationFrame(initialize);
}

const rangeFromRandom = (min, max) => {
  return Math.random() * (max - min) + min;
};

const PARTICLE_COUNT_PER_CLICK = 100;

window.addEventListener("pointerdown", (event) => {
  const rect = canvasElement.getBoundingClientRect();

  const clientX = event.clientX - rect.left;
  const clientY = event.clientY - rect.top;

  const sound = fireworkSound.cloneNode();
  sound.volume = 0.5;
  sound.play();

  const fade = setInterval(() => {
    sound.volume = Math.max(0, sound.volume - 0.01);

    if (sound.volume === 0.01) {
      clearInterval(fade);
      sound.pause();
    }
  }, 50);

  for (let index = 0; index < PARTICLE_COUNT_PER_CLICK; index++) {
    const angle = (Math.PI * 2 * index) / PARTICLE_COUNT_PER_CLICK;
    const speed = rangeFromRandom(3, 7);

    const position = {
      xPosition: clientX,
      yPosition: clientY,
    };

    const velocity = {
      xVelocity: Math.cos(angle) * speed,
      yVelocity: Math.sin(angle) * speed,
    };

    const newParticle = new Particle(
      position,
      velocity,
      rangeFromRandom(4, 20),
      `hsl(${Math.random() * 360}, 50%, 50%)`,
    );

    particlesArray.push(newParticle);
  }
});

initialize();
