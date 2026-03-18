// ----- 기본 상수 -----
const COLS = 10;
const ROWS = 20;
const BLOCK_SIZE = 30; // 10x20 -> 300x600

// 색상 매핑
const COLORS = {
  0: "#111111",
  1: "#00f0f0", // I
  2: "#f0f000", // O
  3: "#a000f0", // T
  4: "#00f000", // S
  5: "#f00000", // Z
  6: "#0000f0", // J
  7: "#f0a000", // L
};

// 테트로미노 모양
const SHAPES = {
  I: [[1, 1, 1, 1]],
  O: [
    [1, 1],
    [1, 1],
  ],
  T: [
    [0, 1, 0],
    [1, 1, 1],
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1],
  ],
  L: [
    [0, 0, 1],
    [1, 1, 1],
  ],
};

const SHAPE_KEYS = Object.keys(SHAPES);
const COLOR_BY_SHAPE = {
  I: 1,
  O: 2,
  T: 3,
  S: 4,
  Z: 5,
  J: 6,
  L: 7,
};

// ----- 게임 상태 -----
let board = [];
let current = null; // {shape, row, col, color}
let nextPiece = null;
let score = 0;
let level = 1;
let linesCleared = 0;
let isGameOver = false;
let isPaused = false;

let dropStart = 0;
let dropInterval = 800; // ms

// ----- 락 딜레이(바닥에서 좌우/회전 한 번 더) -----
const LOCK_DELAY_MS = 400;
let lockPending = false;
let lockStartTs = 0;

// ----- 라인 클리어 효과(폭죽) -----
const EFFECT_DURATION_MS = 500;
let effects = [];

// 캔버스
const boardCanvas = document.getElementById("board");
const boardCtx = boardCanvas.getContext("2d");
const nextCanvas = document.getElementById("next");
const nextCtx = nextCanvas.getContext("2d");

// UI
const scoreEl = document.getElementById("score");
const levelEl = document.getElementById("level");
const linesEl = document.getElementById("lines");
const restartBtn = document.getElementById("restart-btn");
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlayText = document.getElementById("overlay-text");
const overlayBtn = document.getElementById("overlay-btn");

// ----- 유틸 함수 -----
function createEmptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

function rotate(shape) {
  // 시계 방향 회전
  const rows = shape.length;
  const cols = shape[0].length;
  const res = [];
  for (let c = 0; c < cols; c++) {
    const row = [];
    for (let r = rows - 1; r >= 0; r--) {
      row.push(shape[r][c]);
    }
    res.push(row);
  }
  return res;
}

function randomPiece() {
  const key = SHAPE_KEYS[Math.floor(Math.random() * SHAPE_KEYS.length)];
  const baseShape = SHAPES[key];
  const shape = baseShape.map((row) => row.slice());
  const color = COLOR_BY_SHAPE[key];
  const colStart = Math.floor(COLS / 2 - shape[0].length / 2);
  return {
    shape,
    row: 0,
    col: colStart,
    color,
  };
}

function canMove(piece, offsetRow, offsetCol, shapeOverride) {
  const shape = shapeOverride || piece.shape;
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nr = piece.row + r + offsetRow;
      const nc = piece.col + c + offsetCol;
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) {
        return false;
      }
      if (board[nr][nc] !== 0) {
        return false;
      }
    }
  }
  return true;
}

function mergePiece(piece) {
  for (let r = 0; r < piece.shape.length; r++) {
    for (let c = 0; c < piece.shape[r].length; c++) {
      if (!piece.shape[r][c]) continue;
      const br = piece.row + r;
      const bc = piece.col + c;
      if (br >= 0 && br < ROWS && bc >= 0 && bc < COLS) {
        board[br][bc] = piece.color;
      }
    }
  }
}

function clearLines(colorForEffect) {
  let cleared = 0;
  const clearedRows = [];
  outer: for (let r = ROWS - 1; r >= 0; r--) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c] === 0) {
        continue outer;
      }
    }
    // 가득 찬 줄
    clearedRows.push(r);
    board.splice(r, 1);
    board.unshift(Array(COLS).fill(0));
    cleared++;
    r++; // 같은 인덱스 다시 검사
  }

  if (cleared > 0) {
    linesCleared += cleared;
    score += cleared * cleared * 100;
    level = 1 + Math.floor(linesCleared / 10);
    dropInterval = Math.max(150, 800 - (level - 1) * 70);
  }

  updateStats();
  return { cleared, clearedRows, colorForEffect };
}

function hardDrop() {
  if (!current || isGameOver || isPaused) return;
  // 하드 드롭은 락 딜레이 없이 즉시 고정
  lockPending = false;
  while (canMove(current, 1, 0)) {
    current.row += 1;
  }
  mergePiece(current);
  const res = clearLines(current.color);
  if (res.cleared > 0) spawnFirework(res.cleared, res.clearedRows, res.colorForEffect);
  spawnNextPiece();
}

function spawnNextPiece() {
  // 새 블록이 스폰되면 락 딜레이 초기화
  lockPending = false;
  lockStartTs = 0;

  if (!nextPiece) {
    current = randomPiece();
    nextPiece = randomPiece();
  } else {
    current = nextPiece;
    current.row = 0;
    const colStart = Math.floor(COLS / 2 - current.shape[0].length / 2);
    current.col = colStart;
    nextPiece = randomPiece();
  }

  if (!canMove(current, 0, 0)) {
    // 게임 오버
    isGameOver = true;
    showOverlay("게임 오버", `최종 점수: ${score}`, "새 게임 시작");
  }
}

function spawnFirework(cleared, clearedRows, colorId) {
  const particlesByCleared = {
    1: 16,
    2: 30,
    3: 42,
    4: 52,
  };
  const totalParticles = particlesByCleared[Math.min(4, cleared)] || 32;
  const rowsCount = Math.max(1, clearedRows.length);
  const perRow = Math.floor(totalParticles / rowsCount);

  const baseX = (COLS / 2) * BLOCK_SIZE;
  const baseYJitter = BLOCK_SIZE * 0.15;

  const color = COLORS[colorId] || "#ffffff";
  const nowTs = performance.now();
  const gravity = BLOCK_SIZE * 4.2;

  const effect = {
    startTs: nowTs,
    duration: EFFECT_DURATION_MS,
    particles: [],
  };

  for (const rowIdx of clearedRows) {
    const cx = baseX + (Math.random() * 0.6 - 0.3) * BLOCK_SIZE;
    const cy = rowIdx * BLOCK_SIZE + BLOCK_SIZE / 2 + (Math.random() * 2 - 1) * baseYJitter;
    for (let i = 0; i < perRow; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speedMul = 0.8 + Math.random() * (0.9 + cleared * 0.15);
      const speed = (BLOCK_SIZE / 10) * speedMul;
      const p = {
        x0: cx,
        y0: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.85,
        g: gravity * (0.7 + Math.random() * 0.7),
        size: 1.8 + Math.random() * 2.4,
        color,
      };
      effect.particles.push(p);
    }
  }

  effects.push(effect);
}

// ----- 렌더링 -----
function drawCell(ctx, x, y, colorId) {
  const color = COLORS[colorId];
  ctx.fillStyle = color;
  ctx.fillRect(x, y, BLOCK_SIZE, BLOCK_SIZE);

  if (colorId !== 0) {
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, BLOCK_SIZE - 2, BLOCK_SIZE - 2);
  }
}

function drawBoard(nowTs) {
  boardCtx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);

  // 고정 블록
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      drawCell(boardCtx, c * BLOCK_SIZE, r * BLOCK_SIZE, board[r][c]);
    }
  }

  // 현재 블록
  if (current) {
    for (let r = 0; r < current.shape.length; r++) {
      for (let c = 0; c < current.shape[r].length; c++) {
        if (!current.shape[r][c]) continue;
        const x = (current.col + c) * BLOCK_SIZE;
        const y = (current.row + r) * BLOCK_SIZE;
        drawCell(boardCtx, x, y, current.color);
      }
    }
  }

  // 폭죽 효과(블록 위)
  drawEffects(nowTs);
}

function drawEffects(nowTs) {
  if (!effects.length) return;
  const nextEffects = [];

  for (const e of effects) {
    const age = nowTs - e.startTs;
    if (age > e.duration) continue;
    nextEffects.push(e);

    const t = age / e.duration; // 0..1
    const alpha = Math.max(0, 1 - t);

    for (const p of e.particles) {
      const dt = age / 1000; // seconds
      const x = p.x0 + p.vx * dt;
      const y = p.y0 + p.vy * dt + 0.5 * p.g * dt * dt;
      if (y < -10 || y > boardCanvas.height + 10) continue;

      boardCtx.globalAlpha = alpha * 0.95;
      boardCtx.fillStyle = p.color;
      const s = p.size * (0.65 + alpha * 0.9);
      boardCtx.fillRect(x, y, s, s);
    }
  }

  boardCtx.globalAlpha = 1.0;
  effects = nextEffects;
}

function drawNext() {
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  if (!nextPiece) return;
  const shape = nextPiece.shape;
  const rows = shape.length;
  const cols = shape[0].length;

  const totalWidth = cols * BLOCK_SIZE * 0.7;
  const totalHeight = rows * BLOCK_SIZE * 0.7;
  const offsetX = (nextCanvas.width - totalWidth) / 2;
  const offsetY = (nextCanvas.height - totalHeight) / 2;
  const size = BLOCK_SIZE * 0.7;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!shape[r][c]) continue;
      const x = offsetX + c * size;
      const y = offsetY + r * size;
      const color = COLORS[nextPiece.color];
      nextCtx.fillStyle = color;
      nextCtx.fillRect(x, y, size, size);
      nextCtx.strokeStyle = "#000000";
      nextCtx.lineWidth = 2;
      nextCtx.strokeRect(x + 1, y + 1, size - 2, size - 2);
    }
  }
}

function updateStats() {
  scoreEl.textContent = score.toString();
  levelEl.textContent = level.toString();
  linesEl.textContent = linesCleared.toString();
}

// ----- 오버레이 -----
function showOverlay(title, text, btnLabel) {
  overlayTitle.textContent = title;
  overlayText.textContent = text || "";
  overlayBtn.textContent = btnLabel || "계속하기";
  overlay.classList.remove("hidden");
}

function hideOverlay() {
  overlay.classList.add("hidden");
}

// ----- 게임 루프 -----
function tick(timestamp) {
  if (!dropStart) dropStart = timestamp;
  const delta = timestamp - dropStart;

  if (!isPaused && !isGameOver && delta > dropInterval) {
    dropStart = timestamp;
    if (current && canMove(current, 1, 0)) {
      current.row += 1;
      // 바닥에서 다시 뜨면 락 딜레이 리셋
      lockPending = false;
      lockStartTs = 0;
    } else if (current) {
      // 바닥에 닿았을 때 잠깐 대기 후 고정
      if (!lockPending) {
        lockPending = true;
        lockStartTs = timestamp;
      } else if (timestamp - lockStartTs >= LOCK_DELAY_MS) {
        lockPending = false;
        mergePiece(current);
        const res = clearLines(current.color);
        if (res.cleared > 0) spawnFirework(res.cleared, res.clearedRows, res.colorForEffect);
        spawnNextPiece();
      }
    }
  }

  drawBoard(timestamp);
  drawNext();

  requestAnimationFrame(tick);
}

// ----- 입력 처리 -----
function handleKeydown(e) {
  if (isGameOver) return;

  if (e.code === "Enter") {
    // 일시정지 토글
    isPaused = !isPaused;
    if (isPaused) {
      showOverlay("일시정지", "Enter 키를 다시 누르면 계속합니다.", "계속하기");
    } else {
      hideOverlay();
    }
    return;
  }

  if (isPaused) return;
  if (!current) return;

  // 브라우저 스크롤/화면 이동 방지: 화살표 키는 기본 동작이 있을 수 있음
  if (
    e.code === "ArrowLeft" ||
    e.code === "ArrowRight" ||
    e.code === "ArrowUp" ||
    e.code === "ArrowDown"
  ) {
    e.preventDefault();
  }

  switch (e.code) {
    case "ArrowLeft":
      if (canMove(current, 0, -1)) {
        current.col -= 1;
        if (lockPending) lockStartTs = performance.now();
      }
      break;
    case "ArrowRight":
      if (canMove(current, 0, 1)) {
        current.col += 1;
        if (lockPending) lockStartTs = performance.now();
      }
      break;
    case "ArrowDown":
      if (canMove(current, 1, 0)) {
        current.row += 1;
        lockPending = false;
        lockStartTs = 0;
      } else {
        if (!lockPending) {
          lockPending = true;
          lockStartTs = performance.now();
        }
      }
      break;
    case "ArrowUp": {
      const rotated = rotate(current.shape);
      if (canMove(current, 0, 0, rotated)) {
        current.shape = rotated;
        if (lockPending) lockStartTs = performance.now();
      }
      break;
    }
    case "Space":
      e.preventDefault();
      hardDrop();
      break;
  }
}

// ----- 초기화 & 리스타트 -----
function resetGame() {
  board = createEmptyBoard();
  score = 0;
  level = 1;
  linesCleared = 0;
  isGameOver = false;
  isPaused = false;
  dropInterval = 800;
  nextPiece = null;
  current = null;
  lockPending = false;
  lockStartTs = 0;
  updateStats();
  hideOverlay();
  spawnNextPiece();
}

restartBtn.addEventListener("click", () => {
  resetGame();
});

overlayBtn.addEventListener("click", () => {
  if (isGameOver) {
    resetGame();
  } else {
    isPaused = false;
    hideOverlay();
  }
});

document.addEventListener("keydown", handleKeydown);

// ----- 시작 -----
function start() {
  board = createEmptyBoard();
  updateStats();
  spawnNextPiece();
  requestAnimationFrame(tick);
}

start();

