import random
import time
from typing import List, Tuple

import streamlit as st
try:
    from streamlit_autorefresh import st_autorefresh
except Exception:  # Streamlit Cloud에서 패키지 설치가 실패하면 여기로 올 수 있음
    st_autorefresh = None


# ==== 기본 설정 ====
BOARD_ROWS = 20
BOARD_COLS = 10

TETROMINOES = {
    "I": [[1, 1, 1, 1]],
    "O": [[1, 1],
          [1, 1]],
    "T": [[0, 1, 0],
          [1, 1, 1]],
    "S": [[0, 1, 1],
          [1, 1, 0]],
    "Z": [[1, 1, 0],
          [0, 1, 1]],
    "J": [[1, 0, 0],
          [1, 1, 1]],
    "L": [[0, 0, 1],
          [1, 1, 1]],
}

COLORS = {
    0: "#111111",  # 빈칸
    1: "#00f0f0",  # I
    2: "#f0f000",  # O
    3: "#a000f0",  # T
    4: "#00f000",  # S
    5: "#f00000",  # Z
    6: "#0000f0",  # J
    7: "#f0a000",  # L
}


def rerun_app():
    """Streamlit 버전에 따라 rerun API 호환."""
    if hasattr(st, "rerun"):
        st.rerun()
    elif hasattr(st, "experimental_rerun"):
        st.experimental_rerun()


# ==== 유틸 함수 ====
def rotate(shape: List[List[int]]) -> List[List[int]]:
    """시계 방향 회전."""
    return [list(row) for row in zip(*shape[::-1])]


def create_empty_board() -> List[List[int]]:
    return [[0 for _ in range(BOARD_COLS)] for _ in range(BOARD_ROWS)]


def can_move(board, shape, pos_row, pos_col) -> bool:
    for r, row in enumerate(shape):
        for c, cell in enumerate(row):
            if not cell:
                continue
            br = pos_row + r
            bc = pos_col + c
            if br < 0 or br >= BOARD_ROWS or bc < 0 or bc >= BOARD_COLS:
                return False
            if board[br][bc] != 0:
                return False
    return True


def merge_piece(board, shape, pos_row, pos_col, color_id):
    for r, row in enumerate(shape):
        for c, cell in enumerate(row):
            if cell:
                br = pos_row + r
                bc = pos_col + c
                if 0 <= br < BOARD_ROWS and 0 <= bc < BOARD_COLS:
                    board[br][bc] = color_id


def clear_lines(board) -> Tuple[List[List[int]], int]:
    new_board = [row for row in board if any(cell == 0 for cell in row)]
    cleared = BOARD_ROWS - len(new_board)
    for _ in range(cleared):
        new_board.insert(0, [0 for _ in range(BOARD_COLS)])
    return new_board, cleared


def spawn_piece():
    name = random.choice(list(TETROMINOES.keys()))
    shape = [row[:] for row in TETROMINOES[name]]
    color_map = {"I": 1, "O": 2, "T": 3, "S": 4, "Z": 5, "J": 6, "L": 7}
    color_id = color_map[name]
    start_col = BOARD_COLS // 2 - len(shape[0]) // 2
    return shape, 0, start_col, color_id


def init_state():
    st.session_state.board = create_empty_board()
    shape, row, col, color_id = spawn_piece()
    st.session_state.current_shape = shape
    st.session_state.current_row = row
    st.session_state.current_col = col
    st.session_state.current_color = color_id
    st.session_state.score = 0
    st.session_state.level = 1
    st.session_state.lines = 0
    st.session_state.game_over = False
    st.session_state.last_tick = time.time()
    # 착지 후 잠깐 이동/회전 허용을 위한 락 딜레이 상태
    st.session_state.lock_pending = False
    st.session_state.lock_start = 0.0


def ensure_state():
    """코드 변경으로 세션 상태 키가 누락됐을 때도 안전하게 초기화."""
    if "board" not in st.session_state:
        init_state()
        return

    # 새로운 기능(락 딜레이 등) 추가 후, 기존 세션에는 키가 없을 수 있음
    if "current_shape" not in st.session_state:
        shape, row, col, color_id = spawn_piece()
        st.session_state.current_shape = shape
        st.session_state.current_row = row
        st.session_state.current_col = col
        st.session_state.current_color = color_id

    if "score" not in st.session_state:
        st.session_state.score = 0
    if "level" not in st.session_state:
        st.session_state.level = 1
    if "lines" not in st.session_state:
        st.session_state.lines = 0
    if "game_over" not in st.session_state:
        st.session_state.game_over = False
    if "last_tick" not in st.session_state:
        st.session_state.last_tick = time.time()

    if "lock_pending" not in st.session_state:
        st.session_state.lock_pending = False
    if "lock_start" not in st.session_state:
        st.session_state.lock_start = 0.0


def draw_board():
    cell_size = 20
    canvas_width = BOARD_COLS * cell_size
    canvas_height = BOARD_ROWS * cell_size

    # 현재 보드 + 떨어지는 블록을 합쳐서 그림
    temp_board = [row[:] for row in st.session_state.board]
    shape = st.session_state.current_shape
    row = st.session_state.current_row
    col = st.session_state.current_col
    color_id = st.session_state.current_color
    for r, shape_row in enumerate(shape):
        for c, cell in enumerate(shape_row):
            if cell:
                br = row + r
                bc = col + c
                if 0 <= br < BOARD_ROWS and 0 <= bc < BOARD_COLS:
                    temp_board[br][bc] = color_id

    # Streamlit에는 기본 캔버스가 없어서 emoji 기반으로 단순 렌더링
    # (Streamlit-drawable-canvas를 쓰고 싶다면 추가 라이브러리가 필요)
    board_str = ""
    color_to_emoji = {
        0: "⬛",
        1: "🟦",
        2: "🟨",
        3: "🟪",
        4: "🟩",
        5: "🟥",
        6: "🟦",
        7: "🟧",
    }
    for r in range(BOARD_ROWS):
        for c in range(BOARD_COLS):
            board_str += color_to_emoji[temp_board[r][c]]
        board_str += "\n"
    st.markdown(f"<pre style='font-size:16px; line-height:16px'>{board_str}</pre>", unsafe_allow_html=True)


def hard_drop():
    while True:
        if can_move(
            st.session_state.board,
            st.session_state.current_shape,
            st.session_state.current_row + 1,
            st.session_state.current_col,
        ):
            st.session_state.current_row += 1
        else:
            break
    lock_piece()


def lock_piece():
    merge_piece(
        st.session_state.board,
        st.session_state.current_shape,
        st.session_state.current_row,
        st.session_state.current_col,
        st.session_state.current_color,
    )
    st.session_state.board, cleared = clear_lines(st.session_state.board)
    if cleared:
        st.session_state.lines += cleared
        st.session_state.score += (cleared ** 2) * 120  # 조금 더 공격적인 점수
        st.session_state.level = 1 + st.session_state.lines // 10

    # 다음 블록을 위해 락 딜레이 상태 초기화
    st.session_state.lock_pending = False
    st.session_state.lock_start = 0.0

    shape, row, col, color_id = spawn_piece()
    if not can_move(st.session_state.board, shape, row, col):
        st.session_state.game_over = True
    else:
        st.session_state.current_shape = shape
        st.session_state.current_row = row
        st.session_state.current_col = col
        st.session_state.current_color = color_id


def tick():
    if st.session_state.game_over:
        return
    fall_interval = max(0.12, 0.8 - (st.session_state.level - 1) * 0.06)
    now = time.time()
    if now - st.session_state.last_tick < fall_interval:
        return
    st.session_state.last_tick = now

    if can_move(
        st.session_state.board,
        st.session_state.current_shape,
        st.session_state.current_row + 1,
        st.session_state.current_col,
    ):
        st.session_state.current_row += 1
        # 한 칸이라도 내려가면 다시 락 딜레이 초기화
        st.session_state.lock_pending = False
        st.session_state.lock_start = 0.0
    else:
        # 바닥에 닿은 뒤 잠깐 동안 좌우 이동/회전 허용
        lock_delay = 0.4  # 초 단위, 한 번 움직일 정도의 짧은 여유
        if not st.session_state.lock_pending:
            st.session_state.lock_pending = True
            st.session_state.lock_start = now
        elif now - st.session_state.lock_start >= lock_delay:
            lock_piece()


def main():
    st.set_page_config(page_title="클래식 테트리스", page_icon="🎮")
    st.title("🎮 클래식 테트리스 (Streamlit)")
    st.write(
        "초중급용 테트리스입니다. 바닥에 닿았을 때 살짝 좌우로 미끄러뜨릴 수 있게 만들어 더 역동적으로 플레이할 수 있어요."
    )

    ensure_state()

    # 자동 tick
    # Streamlit Cloud에서 experimental API가 없을 수 있어 안전하게 처리합니다.
    # st_autorefresh로 주기적으로 앱을 rerun시키고, tick()은 last_tick/fall_interval로 실제 낙하 속도를 제어합니다.
    if st_autorefresh is not None:
        st_autorefresh(interval=100, limit=None, key="tetris_autorefresh")
    tick()

    col1, col2 = st.columns([3, 1])
    with col1:
        draw_board()
    with col2:
        st.subheader("정보")
        st.write(f"점수: **{st.session_state.score}**")
        st.write(f"라인: **{st.session_state.lines}**")
        st.write(f"레벨: **{st.session_state.level}**")

        if st.button("새 게임 시작"):
            init_state()
            rerun_app()

        st.markdown("---")
        st.subheader("조작")
        c1, c2, c3 = st.columns(3)
        with c1:
            if st.button("⬅️ 좌"):
                if can_move(
                    st.session_state.board,
                    st.session_state.current_shape,
                    st.session_state.current_row,
                    st.session_state.current_col - 1,
                ):
                    st.session_state.current_col -= 1
                    # 좌우 이동에 성공하면 락 딜레이를 다시 부여
                    if st.session_state.lock_pending:
                        st.session_state.lock_start = time.time()
        with c2:
            if st.button("⏫ 회전"):
                new_shape = rotate(st.session_state.current_shape)
                if can_move(
                    st.session_state.board,
                    new_shape,
                    st.session_state.current_row,
                    st.session_state.current_col,
                ):
                    st.session_state.current_shape = new_shape
                    if st.session_state.lock_pending:
                        st.session_state.lock_start = time.time()
        with c3:
            if st.button("➡️ 우"):
                if can_move(
                    st.session_state.board,
                    st.session_state.current_shape,
                    st.session_state.current_row,
                    st.session_state.current_col + 1,
                ):
                    st.session_state.current_col += 1
                    if st.session_state.lock_pending:
                        st.session_state.lock_start = time.time()

        c4, c5 = st.columns(2)
        with c4:
            if st.button("⬇️ 한 칸 내리기"):
                if can_move(
                    st.session_state.board,
                    st.session_state.current_shape,
                    st.session_state.current_row + 1,
                    st.session_state.current_col,
                ):
                    st.session_state.current_row += 1
                    st.session_state.lock_pending = False
                    st.session_state.lock_start = 0.0
                else:
                    # 수동 내리기에서도 바닥에 닿으면 한 번의 락 딜레이를 주고,
                    # 그 이후 다시 내리면 고정
                    now = time.time()
                    lock_delay = 0.4
                    if not st.session_state.lock_pending:
                        st.session_state.lock_pending = True
                        st.session_state.lock_start = now
                    elif now - st.session_state.lock_start >= lock_delay:
                        lock_piece()
        with c5:
            if st.button("⤵️ 하드 드롭"):
                hard_drop()

        if st.session_state.game_over:
            st.error("게임 오버! '새 게임 시작'을 눌러 다시 시작하세요.")


if __name__ == "__main__":
    main()

