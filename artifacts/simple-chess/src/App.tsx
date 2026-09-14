import { type ReactNode, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';

type Color = 'white' | 'black';
type Kind = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
type Board = (Piece | null)[][];
type Point = { x: number; y: number };
type Piece = { kind: Kind; color: Color; moved?: boolean };
type Move = Point & { from: Point; castle?: 'king' | 'queen'; enPassant?: boolean };
type HistoryItem = { white: string; black?: string };
type Game = {
  board: Board;
  turn: Color;
  selected: Point | null;
  lastMove: { from: Point; to: Point } | null;
  history: HistoryItem[];
  captured: { white: Piece[]; black: Piece[] };
  ep: Point | null;
  result: string | null;
  check: boolean;
};

const glyphs: Record<Color, Record<Kind, string>> = {
  white: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  black: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};
const names: Record<Kind, string> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const pieceLetter: Record<Kind, string> = { k: 'K', q: 'Q', r: 'R', b: 'B', n: 'N', p: '' };
const opposite = (color: Color): Color => color === 'white' ? 'black' : 'white';
const pointKey = (p: Point) => `${p.x},${p.y}`;
const inside = (x: number, y: number) => x >= 0 && x < 8 && y >= 0 && y < 8;

function freshBoard(): Board {
  const b: Board = Array.from({ length: 8 }, () => Array<Piece | null>(8).fill(null));
  const back: Kind[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  back.forEach((kind, x) => {
    b[0][x] = { kind, color: 'black' };
    b[1][x] = { kind: 'p', color: 'black' };
    b[6][x] = { kind: 'p', color: 'white' };
    b[7][x] = { kind, color: 'white' };
  });
  return b;
}
const newGame = (): Game => ({
  board: freshBoard(), turn: 'white', selected: null, lastMove: null, history: [],
  captured: { white: [], black: [] }, ep: null, result: null, check: false,
});
const copyBoard = (board: Board): Board => board.map(row => row.map(piece => piece ? { ...piece } : null));

function findKing(board: Board, color: Color): Point | null {
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) {
    if (board[y][x]?.kind === 'k' && board[y][x]?.color === color) return { x, y };
  }
  return null;
}

function attacked(board: Board, target: Point, by: Color): boolean {
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) {
    const p = board[y][x];
    if (!p || p.color !== by) continue;
    const dx = target.x - x;
    const dy = target.y - y;
    if (p.kind === 'p' && Math.abs(dx) === 1 && dy === (by === 'white' ? -1 : 1)) return true;
    if (p.kind === 'n' && ((Math.abs(dx) === 1 && Math.abs(dy) === 2) || (Math.abs(dx) === 2 && Math.abs(dy) === 1))) return true;
    if (p.kind === 'k' && Math.max(Math.abs(dx), Math.abs(dy)) === 1) return true;
    const diagonal = Math.abs(dx) === Math.abs(dy) && dx !== 0;
    const straight = (dx === 0) !== (dy === 0);
    const slides = (p.kind === 'b' && diagonal) || (p.kind === 'r' && straight) || (p.kind === 'q' && (diagonal || straight));
    if (slides) {
      const sx = Math.sign(dx), sy = Math.sign(dy);
      let cx = x + sx, cy = y + sy, clear = true;
      while (cx !== target.x || cy !== target.y) {
        if (board[cy][cx]) { clear = false; break; }
        cx += sx; cy += sy;
      }
      if (clear) return true;
    }
  }
  return false;
}

function makeMove(board: Board, move: Move, promotion: Kind = 'q'): Board {
  const next = copyBoard(board);
  const moving = next[move.from.y][move.from.x];
  if (!moving) return next;
  next[move.from.y][move.from.x] = null;
  if (move.enPassant) next[move.from.y][move.x] = null;
  if (move.castle) {
    const rookX = move.castle === 'king' ? 7 : 0;
    const rookToX = move.castle === 'king' ? 5 : 3;
    const rook = next[move.y][rookX];
    next[move.y][rookX] = null;
    if (rook) next[move.y][rookToX] = { ...rook, moved: true };
  }
  next[move.y][move.x] = { ...moving, moved: true, kind: moving.kind === 'p' && (move.y === 0 || move.y === 7) ? promotion : moving.kind };
  return next;
}

function pseudoMoves(board: Board, from: Point, game: Pick<Game, 'ep'>): Move[] {
  const piece = board[from.y][from.x];
  if (!piece) return [];
  const moves: Move[] = [];
  const add = (x: number, y: number, extra: Partial<Move> = {}) => {
    if (!inside(x, y)) return false;
    const target = board[y][x];
    if (!target) { moves.push({ from, x, y, ...extra }); return true; }
    if (target.color !== piece.color && target.kind !== 'k') moves.push({ from, x, y, ...extra });
    return false;
  };
  if (piece.kind === 'p') {
    const dir = piece.color === 'white' ? -1 : 1;
    const start = piece.color === 'white' ? 6 : 1;
    if (inside(from.x, from.y + dir) && !board[from.y + dir][from.x]) {
      add(from.x, from.y + dir);
      if (from.y === start && !board[from.y + dir * 2][from.x]) add(from.x, from.y + dir * 2);
    }
    [-1, 1].forEach(dx => {
      const x = from.x + dx, y = from.y + dir;
      if (!inside(x, y)) return;
      if (board[y][x] && board[y][x]?.color !== piece.color && board[y][x]?.kind !== 'k') add(x, y);
      if (game.ep && game.ep.x === x && game.ep.y === y) add(x, y, { enPassant: true });
    });
  } else if (piece.kind === 'n' || piece.kind === 'k') {
    const steps = piece.kind === 'n' ? [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
    steps.forEach(([dx, dy]) => add(from.x + dx, from.y + dy));
  } else {
    const directions = piece.kind === 'b' ? [[1, 1], [-1, 1], [1, -1], [-1, -1]] : piece.kind === 'r' ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
    directions.forEach(([dx, dy]) => {
      let x = from.x + dx, y = from.y + dy;
      while (add(x, y)) { x += dx; y += dy; }
    });
  }
  if (piece.kind === 'k' && !piece.moved && !attacked(board, from, opposite(piece.color))) {
    ([['king', 7, 6, 5], ['queen', 0, 2, 3] ] as ['king' | 'queen', number, number, number][]).forEach(([side, rookX, kingToX, transitX]) => {
      const rook = board[from.y][rookX];
      if (!rook || rook.kind !== 'r' || rook.color !== piece.color || rook.moved) return;
      const clear = (rookX === 7 ? [5, 6] : [1, 2, 3]).every(x => !board[from.y][x]);
      const safe = !attacked(board, { x: transitX, y: from.y }, opposite(piece.color));
      if (clear && safe) moves.push({ from, x: kingToX, y: from.y, castle: side });
    });
  }
  return moves;
}

function legalMoves(board: Board, color: Color, game: Pick<Game, 'ep'>): Move[] {
  const all: Move[] = [];
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) {
    const piece = board[y][x];
    if (!piece || piece.color !== color) continue;
    pseudoMoves(board, { x, y }, game).forEach(move => {
      const next = makeMove(board, move);
      const king = findKing(next, color);
      if (king && !attacked(next, king, opposite(color))) all.push(move);
    });
  }
  return all;
}

function notation(board: Board, move: Move, promotion: Kind, givesCheck: boolean, mate: boolean): string {
  const piece = board[move.from.y][move.from.x];
  if (!piece) return '';
  if (move.castle) return `${move.castle === 'king' ? 'O-O' : 'O-O-O'}${mate ? '#' : givesCheck ? '+' : ''}`;
  const captured = Boolean(board[move.y][move.x]) || move.enPassant;
  const pawnFile = piece.kind === 'p' && captured ? files[move.from.x] : '';
  const promote = piece.kind === 'p' && (move.y === 0 || move.y === 7) ? `=${pieceLetter[promotion]}` : '';
  return `${pieceLetter[piece.kind]}${pawnFile}${captured ? '×' : ''}${files[move.x]}${8 - move.y}${promote}${mate ? '#' : givesCheck ? '+' : ''}`;
}

function applyMove(game: Game, move: Move, promotion: Kind): Game {
  const moving = game.board[move.from.y][move.from.x];
  const taken = move.enPassant ? game.board[move.from.y][move.x] : game.board[move.y][move.x];
  const board = makeMove(game.board, move, promotion);
  const nextTurn = opposite(game.turn);
  const ep = moving?.kind === 'p' && Math.abs(move.y - move.from.y) === 2 ? { x: move.from.x, y: (move.y + move.from.y) / 2 } : null;
  const opponentMoves = legalMoves(board, nextTurn, { ep });
  const king = findKing(board, nextTurn);
  const inCheck = Boolean(king && attacked(board, king, game.turn));
  const mate = inCheck && opponentMoves.length === 0;
  const stale = !inCheck && opponentMoves.length === 0;
  const moveText = notation(game.board, move, promotion, inCheck, mate);
  const history = [...game.history];
  if (game.turn === 'white') history.push({ white: moveText }); else history[history.length - 1] = { ...history[history.length - 1], black: moveText };
  const captured = { white: [...game.captured.white], black: [...game.captured.black] };
  if (taken) captured[game.turn].push(taken);
  return { board, turn: nextTurn, selected: null, lastMove: { from: move.from, to: { x: move.x, y: move.y } }, history, captured, ep, check: inCheck, result: mate ? `${game.turn === 'white' ? 'White' : 'Black'} wins by checkmate` : stale ? 'Draw by stalemate' : null };
}

function Home() {
  const [game, setGame] = useState<Game>(newGame);
  const [promotion, setPromotion] = useState<Move | null>(null);
  const possible = useMemo(() => game.selected ? legalMoves(game.board, game.turn, game).filter(m => pointKey(m.from) === pointKey(game.selected!)) : [], [game]);
  const targets = useMemo(() => new Set(possible.map(m => `${m.x},${m.y}`)), [possible]);
  const inCheckKing = game.check ? findKing(game.board, game.turn) : null;
  const chooseSquare = (x: number, y: number) => {
    if (game.result) return;
    const piece = game.board[y][x];
    const chosenMove = possible.find(m => m.x === x && m.y === y);
    if (chosenMove) {
      const moving = game.board[chosenMove.from.y][chosenMove.from.x];
      if (moving?.kind === 'p' && (y === 0 || y === 7)) setPromotion(chosenMove);
      else setGame(current => applyMove(current, chosenMove, 'q'));
      return;
    }
    if (piece?.color === game.turn) setGame(current => ({ ...current, selected: { x, y } }));
    else setGame(current => ({ ...current, selected: null }));
  };
  const statusTitle = game.result || (game.check ? `${game.turn === 'white' ? 'White' : 'Black'} is in check` : `${game.turn === 'white' ? 'White' : 'Black'} to move`);
  const statusDetail = game.result ? 'The board has settled. Start a new game whenever you’re ready.' : game.check ? 'The king is under attack — find a safe reply.' : 'Choose a piece, then choose where it should go.';
  const currentMoveCount = game.history.length;
  return (
    <main className="app-shell">
      <div className="shell-inner">
        <header className="header">
          <div className="brand" data-testid="brand-mark"><div className="brand-mark">♞</div><div><div className="brand-name">The Small Chess Table</div><div className="brand-sub">Local match · no accounts</div></div></div>
          <div className="header-note">A quiet place for sharp thinking</div>
        </header>
        <section className="intro">
          <div className="eyebrow">Two players · one board</div>
          <h1>Take your time.<br /><em>Make your move.</em></h1>
          <p>A focused tabletop match for the browser. Pick up the thread where the last move left it.</p>
        </section>
        <div className="game-layout">
          <section className="board-wrap" aria-label="Chess board">
            <div className="player-bar">
              <div className="player-info"><span className="player-dot light" /><span className="player-name">White</span>{game.turn === 'white' && !game.result && <span className="turn-label">thinking</span>}</div>
              <span className="turn-label">your move, if you play white</span>
            </div>
            <div className="board-frame"><div className="board" data-testid="chess-board">
              {game.board.map((row, y) => row.map((piece, x) => {
                const key = `${x},${y}`, isTarget = targets.has(key), isCapture = isTarget && Boolean(piece);
                const isCheck = Boolean(inCheckKing && inCheckKing.x === x && inCheckKing.y === y);
                const selected = game.selected?.x === x && game.selected?.y === y;
                return <button key={key} className={`square ${(x + y) % 2 === 0 ? 'light-square' : 'dark-square'} ${selected ? 'selected' : ''} ${isCheck ? 'check' : ''} ${game.lastMove && (pointKey(game.lastMove.from) === key || pointKey(game.lastMove.to) === key) ? 'last-move' : ''}`} onClick={() => chooseSquare(x, y)} aria-label={`${files[x]}${8 - y}${piece ? ` ${piece.color} ${names[piece.kind]}` : ''}`} data-testid={`square-${files[x]}${8 - y}`}>
                  {y === 7 && <span className="coord-file">{files[x]}</span>}{x === 0 && <span className="coord-rank">{8 - y}</span>}
                  {isTarget && (isCapture ? <span className="capture-ring" /> : <span className="move-dot" />)}
                  {piece && <span className={`piece ${piece.color}`}>{glyphs[piece.color][piece.kind]}</span>}
                </button>;
              }))}
            </div></div>
            <div className="board-note"><span>White begins</span><span>Files a–h · ranks 1–8</span></div>
            <div className="player-bar" style={{ paddingTop: 17 }}>
              <div className="player-info"><span className="player-dot" /><span className="player-name">Black</span>{game.turn === 'black' && !game.result && <span className="turn-label">thinking</span>}</div>
              <span className="turn-label">your move, if you play black</span>
            </div>
          </section>
          <aside className="side-panel">
            <section className={`status-card ${game.result ? 'game-over-pulse' : ''}`} data-testid="status-message">
              <div className="status-top"><div><div className="eyebrow">Current position</div><div className="status-title">{statusTitle}</div><div className="status-detail">{statusDetail}</div></div><span className={`status-pip ${game.result ? 'over' : ''}`} /></div>
              <button className="new-game" onClick={() => { setGame(newGame()); setPromotion(null); }} data-testid="button-new-game">New game <span aria-hidden="true">↗</span></button>
            </section>
            <section className="panel" data-testid="move-list">
              <div className="panel-heading"><h2>Moves</h2><span>{currentMoveCount} {currentMoveCount === 1 ? 'turn' : 'turns'}</span></div>
              <div className="moves">{game.history.length === 0 ? <div className="empty-moves">The opening is yours.</div> : game.history.map((item, i) => <div className="move-row" key={`${i}-${item.white}`}><span className="move-number">{String(i + 1).padStart(2, '0')}</span><span className={i === game.history.length - 1 && game.turn === 'black' ? 'move-current' : ''}>{item.white}</span><span className={i === game.history.length - 1 && game.turn === 'white' ? 'move-current' : ''}>{item.black || '—'}</span></div>)}</div>
            </section>
            <section className="panel captured-panel" data-testid="captured-pieces">
              <div className="panel-heading"><h2>Off the table</h2><span>captured</span></div>
              <div className="captured-section"><div className="captured-label">White took</div><div className="captured-pieces">{game.captured.white.length ? game.captured.white.map((p, i) => <span key={i}>{glyphs[p.color][p.kind]}</span>) : <span style={{ color: 'hsl(var(--muted-foreground))', fontFamily: 'var(--font-mono)', fontSize: '.65rem', letterSpacing: '.02em' }}>nothing yet</span>}</div></div>
              <div className="captured-section"><div className="captured-label">Black took</div><div className="captured-pieces">{game.captured.black.length ? game.captured.black.map((p, i) => <span key={i}>{glyphs[p.color][p.kind]}</span>) : <span style={{ color: 'hsl(var(--muted-foreground))', fontFamily: 'var(--font-mono)', fontSize: '.65rem', letterSpacing: '.02em' }}>nothing yet</span>}</div></div>
            </section>
            <div className="tip">Select a piece to see its legal moves. A warm ring marks a capture; a small dot marks an open square.</div>
          </aside>
        </div>
      </div>
      {promotion && <div className="promotion-backdrop" role="dialog" aria-modal="true"><div className="promotion-card"><h2>Choose a promotion</h2><p>Your pawn reached the far side of the board.</p><div className="promotion-options">{(['q', 'r', 'b', 'n'] as Kind[]).map(kind => <button className="promotion-option" key={kind} onClick={() => { setGame(current => applyMove(current, promotion, kind)); setPromotion(null); }} data-testid={`promotion-${kind}`}><span className={`piece ${game.turn}`}>{glyphs[game.turn][kind]}</span><small>{names[kind]}</small></button>)}</div></div></div>}
    </main>
  );
}

function Router() {
  return <RoutedErrorBoundary><Switch><Route path="/" component={Home} /><Route component={NotFound} /></Switch></RoutedErrorBoundary>;
}
function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}
const queryClient = new QueryClient();
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}
export default App;