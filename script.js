        tailwind.config = {
            theme: { extend: { colors: { base: '#121214', panel: '#1e1e24', border: '#2a2a32', accent: '#5a6b8c', accentHover: '#6a7ca0' }, fontFamily: { sans: ['Inter', 'sans-serif'] } } }
        }
    </script>
    <script>
        let appMode = 'drawing';
        const MAX_UNDO = 30; let gridSize = 32, currentColor = '#b13e53', currentColorSec = '#000000', currentTool = 'pen'; 
        let colorHistory = ['#1a1c2c', '#b13e53', '#ffffff', '#000000'];
        let isDrawing = false, lastPos = null, useSecondary = false;
        let frames = [], currentFrameIndex = 0, currentLayerIndex = 0, undoStack = [];
        let isPlaying = false, playInterval = null, fps = 12, autoSaveInterval = null;
        let onionSkinning = false, isTileMode = false, isPixelPerfect = false, symX = false, symY = false;
        let floatingSelection = null, selectionBox = null, isSelecting = false, isMoving = false, moveStartX, moveStartY;
        let currentStroke = [], backupGrid = null, shapePreview = null, shapeStart = null, isDrawingShape = false;
        let zoom = 1, panX = 0, panY = 0, isPanning = false, spacePressed = false;
        let brushSize = 1, brushShape = 'square';
        let hsvBackup = null;

        const RETRO_PALETTE = ['#121214', '#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179', '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57', '#000000', '#ffffff', '#eab308'];

        const E = id => document.getElementById(id);
        const workspace = E('workspace'), canvasWrapper = E('canvas-wrapper'), canvasContainer = E('canvas-container'), previewCanvas = E('preview-canvas'), previewCtx = previewCanvas.getContext('2d');
        let paletteGrid, toolButtons;

        function init() { 
            paletteGrid = E('palette-grid'); toolButtons = document.querySelectorAll('[data-tool]'); 
            initPalette(); setColor(currentColor); E('color-picker-sec').value = currentColorSec; updateColorHistoryUI(); 
            initGridSize(32); setupEvents(); 
            loadWelcomeRecentProjects(); 
            autoSaveInterval = setInterval(autoSaveProject, 30000); 
        }
        function setAppMode(mode) {
            appMode = mode;
            const timelineFooter = document.querySelector('footer');
            if (mode === 'drawing') {
                timelineFooter.classList.add('hidden');
            } else {
                timelineFooter.classList.remove('hidden');
            }
        }
        function createEmptyGrid() { return Array(gridSize).fill(null).map(() => Array(gridSize).fill(null)); }
        function initData() { frames = [{ id: Date.now().toString(), layers: [{ id: Date.now().toString()+'l', name: 'Layer 1', visible: true, opacity: 1, blendMode: 'normal', grid: createEmptyGrid() }] }]; currentFrameIndex = 0; currentLayerIndex = 0; undoStack = []; commitAndClearSelection(); shapePreview = null; }
        function initGridSize(size) { gridSize = size; document.querySelectorAll('[data-size]').forEach(b => b.className = parseInt(b.dataset.size) === size ? 'px-3 py-1.5 rounded-sm text-xs font-semibold bg-accent text-white shadow transition-all' : 'px-3 py-1.5 rounded-sm text-xs font-semibold text-gray-400 hover:text-white hover:bg-[#2a2a32] transition-colors'); initData(); initDOMGrid(); renderTimeline(); renderLayersPanel(); renderMainGrid(); updateSymmetryUI(); }

        function initDOMGrid() {
            canvasContainer.style.gridTemplateColumns = `repeat(${gridSize}, 1fr)`; canvasContainer.style.gridTemplateRows = `repeat(${gridSize}, 1fr)`; canvasContainer.style.display = 'grid'; canvasContainer.innerHTML = '';
            for (let y = 0; y < gridSize; y++) {
                for (let x = 0; x < gridSize; x++) {
                    const c = document.createElement('div'); c.className = 'pixel-cell'; c.dataset.x = x; c.dataset.y = y;
                    c.addEventListener('mousedown', e => {
                        if (isPlaying || spacePressed) return;
                        if (e.altKey) { 
                            const col = frames[currentFrameIndex].layers[currentLayerIndex].grid[y][x] || getCompositedColorRGB(currentFrameIndex, x, y);
                            if (col) { let h = col; if(col.startsWith('rgba')) h=rgbToHex(col); if(e.button===2){ currentColorSec=h; E('color-picker-sec').value=h; } else setColor(h); }
                            return; 
                        }
                        if (e.button !== 0 && e.button !== 2) return;
                        useSecondary = (e.button === 2);
                        if (currentTool === 'text') { handleText(x, y); return; }
                        if (currentTool === 'select') {
                            if (floatingSelection && x>=floatingSelection.x && x<floatingSelection.x+floatingSelection.w && y>=floatingSelection.y && y<floatingSelection.y+floatingSelection.h) { isMoving = true; moveStartX = x; moveStartY = y; } 
                            else { commitSelection(); isSelecting = true; selectionBox = { startX: x, startY: y, endX: x, endY: y }; updateSelectionOverlay(); } return;
                        }
                        const l = frames[currentFrameIndex].layers[currentLayerIndex]; if (!l.visible) return;
                        if (['line', 'rect', 'circle'].includes(currentTool)) { shapeStart = {x, y}; shapePreview = { grid: createEmptyGrid() }; isDrawingShape = true; return; }
                        if (currentTool === 'outline') { applyOutline(); return; }
                        isDrawing = true; saveState();
                        if ((currentTool === 'pen' || currentTool === 'eraser' || currentTool === 'burn' || currentTool === 'dodge') && isPixelPerfect) { currentStroke = []; backupGrid = JSON.parse(JSON.stringify(l.grid)); }
                        lastPos = {x, y}; handleInteract(x, y);
                    });
                    c.addEventListener('mouseenter', e => {
                        if ((e.buttons === 1 || e.buttons === 2) && !isPlaying && !spacePressed) {
                            if (currentTool === 'select') {
                                if (isSelecting) { selectionBox.endX = x; selectionBox.endY = y; updateSelectionOverlay(); } 
                                else if (isMoving && (x-moveStartX!==0 || y-moveStartY!==0)) { floatingSelection.x += x-moveStartX; floatingSelection.y += y-moveStartY; moveStartX = x; moveStartY = y; updateSelectionOverlay(); renderMainGrid(); }
                                return;
                            }
                            if (isDrawingShape) {
                                shapePreview.grid = createEmptyGrid();
                                getSymmetricPoints(shapeStart.x, shapeStart.y).forEach((sP, i) => { const eP = getSymmetricPoints(x, y)[i]; const drawC = useSecondary ? currentColorSec : currentColor; if (currentTool==='line') drawLineToGrid(sP.x, sP.y, eP.x, eP.y, drawC, shapePreview.grid); if (currentTool==='rect') drawRectToGrid(sP.x, sP.y, eP.x, eP.y, drawC, shapePreview.grid); if (currentTool==='circle') drawCircleToGrid(sP.x, sP.y, eP.x, eP.y, drawC, shapePreview.grid); }); renderMainGrid(); return;
                            }
                            if (isDrawing) { if (lastPos && ['pen','eraser','dither','burn','dodge'].includes(currentTool)) getBresenhamLine(lastPos.x, lastPos.y, x, y).forEach(p => handleInteract(p.x, p.y)); else handleInteract(x, y); lastPos = {x, y}; }
                        }
                    });
                    c.addEventListener('contextmenu', e => { e.preventDefault(); });
                    canvasContainer.appendChild(c);
                }
            }
        }

        function updateTransform() { canvasWrapper.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`; E('zoom-level').textContent = Math.round(zoom * 100); }
        function updateSymmetryUI() { E('sym-line-x').style.left = '50%'; E('sym-line-y').style.top = '50%'; E('sym-line-x').classList.toggle('hidden', !symX); E('sym-line-y').classList.toggle('hidden', !symY); }
        function getSymmetricPoints(x, y) { const pts = [{x, y}]; if (symX) pts.push({x: gridSize-1-x, y}); if (symY) pts.push({x, y: gridSize-1-y}); if (symX&&symY) pts.push({x: gridSize-1-x, y: gridSize-1-y}); return pts.filter((v,i,a) => a.findIndex(t => t.x===v.x && t.y===v.y)===i); }

        function handleInteract(x, y) {
            if (currentTool === 'magic-wand') { applyMagicWand(x, y); return; }
            if (currentTool === 'replace-color') { applyReplaceColor(x, y); return; }
            const col = currentTool === 'eraser' ? null : (useSecondary ? currentColorSec : currentColor);
            if (['pen', 'eraser', 'dither', 'burn', 'dodge'].includes(currentTool)) {
                getSymmetricPoints(x, y).forEach(sp => {
                    applyBrushFootprint(sp.x, sp.y, (px, py) => {
                        if (currentTool === 'dither' && (px+py)%2!==0) return;
                        if (isPixelPerfect && currentTool!=='dither') {
                            if (currentStroke.length===0 || currentStroke[currentStroke.length-1].x!==px || currentStroke[currentStroke.length-1].y!==py) { currentStroke.push({x:px, y:py, color:col, action:currentTool}); applyPixelPerfect(); }
                        } else {
                            if (currentTool==='burn') applyBurnDodge(px, py, 'burn'); else if (currentTool==='dodge') applyBurnDodge(px, py, 'dodge'); else setPixel(px, py, col);
                        }
                    });
                });
            } else if (currentTool === 'bucket') floodFill(x, y, col);
        }

        function applyBrushFootprint(cx, cy, fn) {
            if (brushSize === 1) { fn(cx, cy); return; }
            const r = Math.floor(brushSize/2), off = brushSize%2===0?-1:0;
            for (let y=-r; y<=r+off; y++) for (let x=-r; x<=r+off; x++) if (brushShape!=='circle' || Math.sqrt(x*x+y*y)<=brushSize/2) fn(cx+x, cy+y);
        }

        function applyOutline() {
            const l = frames[currentFrameIndex].layers[currentLayerIndex]; if(!l.visible)return;
            saveState(); const newGrid = JSON.parse(JSON.stringify(l.grid));
            const c = useSecondary ? currentColorSec : currentColor;
            for(let y=0;y<gridSize;y++)for(let x=0;x<gridSize;x++){
                if(l.grid[y][x]) continue; let hn = false;
                if(x>0&&l.grid[y][x-1]) hn=true; if(x<gridSize-1&&l.grid[y][x+1]) hn=true;
                if(y>0&&l.grid[y-1][x]) hn=true; if(y<gridSize-1&&l.grid[y+1][x]) hn=true;
                if(hn) newGrid[y][x] = c;
            }
            l.grid = newGrid; renderMainGrid();
        }

        function handleText(x, y) {
            const txt = prompt("Enter text to draw:"); if (!txt) return; saveState();
            const c = document.createElement('canvas'), ctx = c.getContext('2d'); ctx.font = '10px monospace';
            c.width = Math.ceil(ctx.measureText(txt).width) + 2; c.height = 12; ctx.font = '10px monospace'; ctx.fillStyle = '#000'; ctx.fillText(txt, 1, 9);
            const img = ctx.getImageData(0,0,c.width,c.height), l = frames[currentFrameIndex].layers[currentLayerIndex], drawC = useSecondary ? currentColorSec : currentColor;
            for(let iy=0; iy<c.height; iy++) for(let ix=0; ix<c.width; ix++) if (img.data[(iy*c.width+ix)*4+3]>128 && y+iy>=0 && y+iy<gridSize && x+ix>=0 && x+ix<gridSize) l.grid[y+iy][x+ix] = drawC;
            renderMainGrid();
        }

        function applyBurnDodge(x, y, mode) {
            const l = frames[currentFrameIndex].layers[currentLayerIndex]; if(!l.visible || x<0||x>=gridSize||y<0||y>=gridSize || !l.grid[y][x]) return;
            const rgb = hexToRgb(l.grid[y][x]), hsl = hexToHSL("#"+[rgb.r,rgb.g,rgb.b].map(v=>v.toString(16).padStart(2,'0')).join(''));
            if(mode==='burn') hsl.l=Math.max(0,hsl.l-5); else hsl.l=Math.min(100,hsl.l+5); l.grid[y][x] = HSLToHex(hsl.h, hsl.s, hsl.l); renderMainGrid();
        }

        function applyMagicWand(startX, startY) {
            const l = frames[currentFrameIndex].layers[currentLayerIndex], tC = l.grid[startY][startX], st = [[startX, startY]], vis = createEmptyGrid(), sel = [];
            while(st.length>0) { const [cx,cy] = st.pop(); if(cx<0||cx>=gridSize||cy<0||cy>=gridSize || vis[cy][cx] || l.grid[cy][cx]!==tC) continue; vis[cy][cx]=true; sel.push({x:cx,y:cy}); st.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]); }
            if (sel.length>0) { commitAndClearSelection(); const minX=Math.min(...sel.map(p=>p.x)), maxX=Math.max(...sel.map(p=>p.x)), minY=Math.min(...sel.map(p=>p.y)), maxY=Math.max(...sel.map(p=>p.y)), w=maxX-minX+1, h=maxY-minY+1; floatingSelection = { grid: Array(h).fill(null).map(()=>Array(w).fill(null)), x: minX, y: minY, w, h }; saveState(); sel.forEach(p=>{floatingSelection.grid[p.y-minY][p.x-minX]=l.grid[p.y][p.x]; l.grid[p.y][p.x]=null;}); setTool('select'); updateSelectionOverlay(); renderMainGrid(); }
        }
        function applyReplaceColor(x, y) { const l = frames[currentFrameIndex].layers[currentLayerIndex], tc = l.grid[y][x]; if(!tc) return; saveState(); const c = useSecondary ? currentColorSec : currentColor; for(let cy=0;cy<gridSize;cy++)for(let cx=0;cx<gridSize;cx++)if(l.grid[cy][cx]===tc)l.grid[cy][cx]=c; renderMainGrid(); }
        function applyPixelPerfect() {
            const l = frames[currentFrameIndex].layers[currentLayerIndex]; for(let y=0;y<gridSize;y++)for(let x=0;x<gridSize;x++)l.grid[y][x]=backupGrid[y][x];
            const fil = []; for (let i=0; i<currentStroke.length; i++) { if (i>0 && i<currentStroke.length-1) { const p1=currentStroke[i-1],p2=currentStroke[i],p3=currentStroke[i+1]; if(((p1.x===p2.x&&p2.y===p3.y)||(p1.y===p2.y&&p2.x===p3.x)) && (p1.x!==p3.x&&p1.y!==p3.y)) continue; } fil.push(currentStroke[i]); }
            for (const p of fil) { if(p.action==='burn'||p.action==='dodge') applyBurnDodge(p.x, p.y, p.action); else l.grid[p.y][p.x]=p.color; } renderMainGrid();
        }

        function getBresenhamLine(x0,y0,x1,y1) { const pts=[]; let dx=Math.abs(x1-x0),dy=Math.abs(y1-y0),sx=x0<x1?1:-1,sy=y0<y1?1:-1,err=dx-dy; while(true){pts.push({x:x0,y:y0}); if(x0===x1&&y0===y1)break; let e2=2*err; if(e2>-dy){err-=dy;x0+=sx;} if(e2<dx){err+=dx;y0+=sy;} } return pts; }
        function drawLineToGrid(x0,y0,x1,y1,c,g) { getBresenhamLine(x0,y0,x1,y1).forEach(p=>{if(g[p.y]&&g[p.y][p.x]!==undefined)g[p.y][p.x]=c;}); }
        function drawRectToGrid(x0,y0,x1,y1,c,g) { const mx=Math.min(x0,x1),Mx=Math.max(x0,x1),my=Math.min(y0,y1),My=Math.max(y0,y1); for(let y=my;y<=My;y++)for(let x=mx;x<=Mx;x++)if(x===mx||x===Mx||y===my||y===My){if(g[y]&&g[y][x]!==undefined)g[y][x]=c;} }
        function drawCircleToGrid(x0,y0,x1,y1,c,g) { let r=Math.round(Math.sqrt((x1-x0)**2+(y1-y0)**2)),x=0,y=r,d=3-2*r; const pts=(cx,cy,x,y)=>[ [cx+x,cy+y],[cx-x,cy+y],[cx+x,cy-y],[cx-x,cy-y],[cx+y,cy+x],[cx-y,cy+x],[cx+y,cy-x],[cx-y,cy-x] ].forEach(([px,py])=>{if(py>=0&&py<gridSize&&px>=0&&px<gridSize)g[py][px]=c;}); pts(x0,y0,x,y); while(y>=x){x++;if(d>0){y--;d+=4*(x-y)+10;}else d+=4*x+6; pts(x0,y0,x,y);} }

        function setPixel(x, y, col) { const l = frames[currentFrameIndex].layers[currentLayerIndex]; if(!l.visible||x<0||x>=gridSize||y<0||y>=gridSize)return; if(l.grid[y][x]===col)return; l.grid[y][x]=col; renderMainGrid(); }
        function floodFill(sx, sy, col) { const l = frames[currentFrameIndex].layers[currentLayerIndex]; if(!l.visible)return; const tc = l.grid[sy][sx]; if(tc===col)return; const st=[[sx,sy]]; while(st.length>0){const[x,y]=st.pop(); if(x<0||x>=gridSize||y<0||y>=gridSize||l.grid[y][x]!==tc)continue; l.grid[y][x]=col; st.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);} renderMainGrid(); }

        function commitAndClearSelection() { if (floatingSelection) commitSelection(); selectionBox = null; updateSelectionOverlay(); }
        function saveState() { commitAndClearSelection(); undoStack.push({ frames: JSON.parse(JSON.stringify(frames)), currentFrameIndex, currentLayerIndex }); if(undoStack.length>MAX_UNDO)undoStack.shift(); }
        function undo() { if(undoStack.length===0||isPlaying)return; commitAndClearSelection(); const s=undoStack.pop(); frames=s.frames; currentFrameIndex=s.currentFrameIndex; currentLayerIndex=s.currentLayerIndex; renderTimeline(); renderLayersPanel(); renderMainGrid(); }
        function updateSelectionOverlay() { const d = E('selection-overlay'); if(!selectionBox&&!floatingSelection){d.classList.add('hidden');return;} d.classList.remove('hidden'); let mx,my,w,h; if(isSelecting&&selectionBox){mx=Math.min(selectionBox.startX,selectionBox.endX);const Mx=Math.max(selectionBox.startX,selectionBox.endX); my=Math.min(selectionBox.startY,selectionBox.endY);const My=Math.max(selectionBox.startY,selectionBox.endY); w=Mx-mx+1;h=My-my+1;} else if(floatingSelection){mx=floatingSelection.x;my=floatingSelection.y;w=floatingSelection.w;h=floatingSelection.h;} else return; d.style.left=(mx/gridSize*100)+'%'; d.style.top=(my/gridSize*100)+'%'; d.style.width=(w/gridSize*100)+'%'; d.style.height=(h/gridSize*100)+'%'; }
        function commitSelection() { if(!floatingSelection)return; const l=frames[currentFrameIndex].layers[currentLayerIndex]; for(let y=0;y<floatingSelection.h;y++)for(let x=0;x<floatingSelection.w;x++){const gy=floatingSelection.y+y,gx=floatingSelection.x+x,c=floatingSelection.grid[y][x]; if(c&&gy>=0&&gy<gridSize&&gx>=0&&gx<gridSize)l.grid[gy][gx]=c;} floatingSelection=null; selectionBox=null; updateSelectionOverlay(); renderMainGrid(); }

        // Create floating selection from current selection box
        function createFloatingSelection(){
            if(!selectionBox) return;
            const minX=Math.min(selectionBox.startX,selectionBox.endX);
            const maxX=Math.max(selectionBox.startX,selectionBox.endX);
            const minY=Math.min(selectionBox.startY,selectionBox.endY);
            const maxY=Math.max(selectionBox.startY,selectionBox.endY);
            const w=maxX-minX+1;
            const h=maxY-minY+1;
            floatingSelection={grid:Array(h).fill(null).map(()=>Array(w).fill(null)), x:minX, y:minY, w, h};
            // copy selected pixels
            const l=frames[currentFrameIndex].layers[currentLayerIndex];
            for(let yy=0; yy<h; yy++){
                for(let xx=0; xx<w; xx++){
                    const gx=minX+xx, gy=minY+yy;
                    const col=l.grid[gy][gx];
                    if(col){
                        floatingSelection.grid[yy][xx]=col;
                        l.grid[gy][gx]=null;
                    }
                }
            }
            setTool('select');
            updateSelectionOverlay();
            renderMainGrid();
        }

        // Compositing & Render
        function getCompositedColorRGB(fIndex, x, y) {
            let fR=0, fG=0, fB=0, fA=0; const fr = frames[fIndex];
            for (let i=0; i<fr.layers.length; i++) {
                const l = fr.layers[i]; if (!l.visible || !l.grid[y][x]) continue;
                const rgb = hexToRgb(l.grid[y][x]), a = l.opacity;
                if (fA === 0) { fR=rgb.r; fG=rgb.g; fB=rgb.b; fA=a; continue; }
                let oR=rgb.r, oG=rgb.g, oB=rgb.b;
                if(l.blendMode==='multiply'){ oR=(fR*rgb.r)/255; oG=(fG*rgb.g)/255; oB=(fB*rgb.b)/255; } else if(l.blendMode==='screen'){ oR=255-((255-fR)*(255-rgb.r)/255); oG=255-((255-fG)*(255-rgb.g)/255); oB=255-((255-fB)*(255-rgb.b)/255); } else if(l.blendMode==='add'){ oR=Math.min(255,fR+rgb.r); oG=Math.min(255,fG+rgb.g); oB=Math.min(255,fB+rgb.b); }
                const outA = a + fA*(1-a); if (outA>0) { fR=(oR*a+fR*fA*(1-a))/outA; fG=(oG*a+fG*fA*(1-a))/outA; fB=(oB*a+fB*fA*(1-a))/outA; } fA = outA;
            }
            if (fIndex===currentFrameIndex && floatingSelection && x>=floatingSelection.x && x<floatingSelection.x+floatingSelection.w && y>=floatingSelection.y && y<floatingSelection.y+floatingSelection.h) { const c=floatingSelection.grid[y-floatingSelection.y][x-floatingSelection.x]; if(c){const rgb=hexToRgb(c); fR=rgb.r;fG=rgb.g;fB=rgb.b;fA=1;} }
            if (fIndex===currentFrameIndex && shapePreview && shapePreview.grid[y][x]) { const rgb=hexToRgb(shapePreview.grid[y][x]); fR=rgb.r;fG=rgb.g;fB=rgb.b;fA=1; }
            return fA===0 ? null : `rgba(${Math.round(fR)},${Math.round(fG)},${Math.round(fB)},${fA})`;
        }
        function renderMainGrid() {
            for (let y=0; y<gridSize; y++) { for (let x=0; x<gridSize; x++) {
                let c = getCompositedColorRGB(currentFrameIndex, x, y);
                if (!c && onionSkinning && currentFrameIndex>0) { const pC = getCompositedColorRGB(currentFrameIndex-1, x, y); if (pC) c = pC.replace(/[\d\.]+\)$/g, '0.4)'); }
                const cell = canvasContainer.children[y*gridSize+x]; if (c) cell.style.setProperty('--cell-color', c); else cell.style.removeProperty('--cell-color');
            } } updatePreview();
        }
        function updatePreview() {
            previewCanvas.width = isTileMode ? gridSize*3 : gridSize; previewCanvas.height = isTileMode ? gridSize*3 : gridSize;
            const id = previewCtx.createImageData(gridSize, gridSize);
            for (let y=0; y<gridSize; y++) for (let x=0; x<gridSize; x++) { const idx=(y*gridSize+x)*4, c=getCompositedColorRGB(currentFrameIndex,x,y); if(c){ const m=c.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/); id.data[idx]=parseInt(m[1]);id.data[idx+1]=parseInt(m[2]);id.data[idx+2]=parseInt(m[3]);id.data[idx+3]=Math.round(parseFloat(m[4])*255); } else id.data[idx+3]=0; }
            if (isTileMode) { const t=document.createElement('canvas'); t.width=gridSize; t.height=gridSize; t.getContext('2d').putImageData(id,0,0); for(let ty=0;ty<3;ty++)for(let tx=0;tx<3;tx++)previewCtx.drawImage(t,tx*gridSize,ty*gridSize); } else previewCtx.putImageData(id,0,0);
        }

        // Frames / Timeline
        function addFrame() { commitAndClearSelection(); saveState(); frames.push({ id: Date.now().toString(), layers: [{ id: Date.now().toString()+'l', name: 'Layer 1', visible: true, opacity: 1, blendMode: 'normal', grid: createEmptyGrid() }] }); currentFrameIndex = frames.length-1; currentLayerIndex = 0; renderTimeline(); renderLayersPanel(); renderMainGrid(); const tl=E('timeline-frames'); setTimeout(()=>tl.scrollLeft=tl.scrollWidth, 50); }
        function renderTimeline() {
            const tl = E('timeline-frames'); tl.innerHTML = '';
            frames.forEach((f, idx) => {
                const d = document.createElement('div'); d.className = `w-[64px] h-[64px] shrink-0 bg-base border-2 rounded cursor-pointer relative group flex items-center justify-center overflow-hidden transition-all ${idx===currentFrameIndex ? 'border-accent shadow-[0_0_12px_rgba(90,107,140,0.6)] scale-105' : 'border-border hover:border-gray-500'}`;
                const c = document.createElement('canvas'); c.width=gridSize; c.height=gridSize; c.className='w-[85%] h-[85%] pixelated-render checkered-bg-small'; const ctx=c.getContext('2d'), id=ctx.createImageData(gridSize, gridSize);
                for(let y=0; y<gridSize; y++)for(let x=0; x<gridSize; x++){ const col=getCompositedColorRGB(idx,x,y), i=(y*gridSize+x)*4; if(col){ const m=col.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/); id.data[i]=parseInt(m[1]); id.data[i+1]=parseInt(m[2]); id.data[i+2]=parseInt(m[3]); id.data[i+3]=Math.round(parseFloat(m[4])*255); } else id.data[i+3]=0; }
                ctx.putImageData(id, 0, 0); d.appendChild(c); const n=document.createElement('div'); n.className='absolute top-0 left-0 bg-black/80 text-white text-[9px] px-1 rounded-br font-mono border-r border-b border-[#333]'; n.textContent=idx+1; d.appendChild(n);
                const ov=document.createElement('div'); ov.className='absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 backdrop-blur-[1px]';
                const dp=document.createElement('button'); dp.innerHTML='<i class="fa-solid fa-copy text-[10px]"></i>'; dp.className='text-white hover:text-accent p-1'; dp.onclick=e=>{e.stopPropagation();commitAndClearSelection();saveState();frames.splice(idx+1,0,{id:Date.now().toString(),layers:f.layers.map(l=>({...l,id:Date.now().toString()+Math.random(),grid:JSON.parse(JSON.stringify(l.grid))}))});currentFrameIndex=idx+1;renderTimeline();renderLayersPanel();renderMainGrid();};
                const dl=document.createElement('button'); dl.innerHTML='<i class="fa-solid fa-trash text-[10px]"></i>'; dl.className='text-white hover:text-red-400 p-1'; dl.onclick=e=>{e.stopPropagation();if(frames.length===1)return;commitAndClearSelection();saveState();frames.splice(idx,1);if(currentFrameIndex>=frames.length)currentFrameIndex=frames.length-1;renderTimeline();renderLayersPanel();renderMainGrid();};
                if(frames.length>1)ov.appendChild(dl); ov.appendChild(dp); d.appendChild(ov);
                d.onclick=()=>{commitAndClearSelection();currentFrameIndex=idx;currentLayerIndex=Math.min(currentLayerIndex, frames[idx].layers.length-1);renderTimeline();renderLayersPanel();renderMainGrid();}; tl.appendChild(d);
            });
        }

        // Layers
        function renderLayersPanel() {
            const list = E('layers-list'); list.innerHTML = ''; const fr = frames[currentFrameIndex];
            [...fr.layers].reverse().forEach((l, rI) => {
                const aI = fr.layers.length-1-rI, d = document.createElement('div'); d.className = `flex flex-col p-2 rounded cursor-pointer border transition-colors ${aI===currentLayerIndex ? 'bg-accent/20 border-accent/60 shadow-inner' : 'bg-base border-border hover:border-gray-600'}`;
                const top = document.createElement('div'); top.className = 'flex items-center justify-between w-full';
                const ls = document.createElement('div'); ls.className = 'flex items-center gap-2 overflow-hidden';
                const eye = document.createElement('button'); eye.innerHTML=`<i class="fa-solid ${l.visible?'fa-eye text-gray-300':'fa-eye-slash text-gray-600'} text-xs"></i>`; eye.onclick=e=>{e.stopPropagation();saveState();l.visible=!l.visible;renderLayersPanel();renderMainGrid();};
                const nm = document.createElement('span'); nm.className=`text-[10px] font-semibold truncate ${aI===currentLayerIndex?'text-white':'text-gray-400'}`; nm.textContent=l.name;
                ls.appendChild(eye); ls.appendChild(nm); top.appendChild(ls);
                if (fr.layers.length>1) { const del=document.createElement('button'); del.innerHTML='<i class="fa-solid fa-trash text-[9px]"></i>'; del.className='text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all'; d.classList.add('group'); del.onclick=e=>{e.stopPropagation();commitAndClearSelection();saveState();fr.layers.splice(aI,1);if(currentLayerIndex>=fr.layers.length)currentLayerIndex=fr.layers.length-1;renderLayersPanel();renderMainGrid();}; top.appendChild(del); }
                d.appendChild(top); d.onclick=()=>{commitAndClearSelection();currentLayerIndex=aI;renderLayersPanel();};
                
                if (aI === currentLayerIndex) {
                    const setDiv = document.createElement('div'); setDiv.className='flex items-center gap-2 mt-2 w-full pt-2 border-t border-border/50';
                    const opIn = document.createElement('input'); opIn.type='range'; opIn.min='0'; opIn.max='100'; opIn.value=l.opacity*100; opIn.className='flex-1 h-1 bg-[#2a2a32] rounded appearance-none cursor-pointer accent-white'; opIn.onclick=e=>e.stopPropagation(); opIn.oninput=e=>{l.opacity=e.target.value/100;renderMainGrid();};
                    const mdSel = document.createElement('select'); mdSel.className='bg-base border border-border text-[9px] text-gray-300 rounded px-1 py-0.5 outline-none font-bold uppercase'; ['normal','multiply','screen','add'].forEach(m=>{const o=document.createElement('option');o.value=m;o.textContent=m;if(l.blendMode===m)o.selected=true;mdSel.appendChild(o);}); mdSel.onclick=e=>e.stopPropagation(); mdSel.onchange=e=>{l.blendMode=e.target.value;renderMainGrid();};
                    setDiv.appendChild(opIn); setDiv.appendChild(mdSel); d.appendChild(setDiv);
                } list.appendChild(d);
            });
        }

            frames.forEach(f=>f.layers.forEach(l=>{if(l.opacity===undefined)l.opacity=1;if(!l.blendMode)l.blendMode='normal';}));
            currentFrameIndex = 0; currentLayerIndex = 0; undoStack = []; E('fps-input').value = fps;
            document.querySelectorAll('[data-size]').forEach(b=>b.className=parseInt(b.dataset.size)===gridSize?'px-3 py-1.5 rounded-sm text-xs font-semibold bg-accent text-white shadow transition-all':'px-3 py-1.5 rounded-sm text-xs font-semibold text-gray-400 hover:text-white hover:bg-[#2a2a32] transition-colors');
            initDOMGrid(); renderTimeline(); renderLayersPanel(); renderMainGrid(); updateSymmetryUI();
        }

        function exportImage(type, scale) {
            commitAndClearSelection(); const sc = scale, fs = gridSize*sc, c = document.createElement('canvas'); c.width = type==='sheet' ? fs*frames.length : fs; c.height = fs;
            const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
            if (type==='png') { for(let y=0;y<gridSize;y++)for(let x=0;x<gridSize;x++){const col=getCompositedColorRGB(currentFrameIndex,x,y);if(col){ctx.fillStyle=col;ctx.fillRect(x*sc,y*sc,sc,sc);}} }
            else if (type==='sheet') { frames.forEach((f,i)=>{const off=i*fs;for(let y=0;y<gridSize;y++)for(let x=0;x<gridSize;x++){const col=getCompositedColorRGB(i,x,y);if(col){ctx.fillStyle=col;ctx.fillRect(off+(x*sc),y*sc,sc,sc);}}}); }
            const l = document.createElement('a'); l.download = type==='sheet' ? `spritesheet_${gridSize}px.png` : `frame_${currentFrameIndex}_${gridSize}px.png`; l.href = c.toDataURL(); l.click(); E('export-modal').classList.add('hidden');
        }

        function exportSVG() {
            let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${gridSize} ${gridSize}">\n`;
            for(let y=0;y<gridSize;y++)for(let x=0;x<gridSize;x++){const col=getCompositedColorRGB(currentFrameIndex,x,y);if(col){svg+=`<rect x="${x}" y="${y}" width="1" height="1" fill="${col}"/>\n`;}}
            svg += `</svg>`;
            const b = new Blob([svg], {type: 'image/svg+xml'}); const l = document.createElement('a'); l.download = `pixel_${gridSize}px.svg`; l.href = URL.createObjectURL(b); l.click(); E('export-modal').classList.add('hidden');
        }

        function exportCSS() {
            let css = '', w = 0, h = 0;
            for(let y=0;y<gridSize;y++)for(let x=0;x<gridSize;x++){const col=getCompositedColorRGB(currentFrameIndex,x,y);if(col){ if(css) css += ', '; css += `${x}px ${y}px ${col}`; w=Math.max(w, x); h=Math.max(h, y); }}
            const str = `.pixel-art { width: 1px; height: 1px; box-shadow: ${css}; }`;
            navigator.clipboard.writeText(str).then(()=>alert('CSS Copied to clipboard!')).catch(e=>alert('Failed to copy CSS')); E('export-modal').classList.add('hidden');
        }

        function setupEvents() {
            window.addEventListener('mouseup', () => { isDrawing = false; lastPos = null; if (isDrawingShape) { isDrawingShape = false; saveState(); const l = frames[currentFrameIndex].layers[currentLayerIndex]; for (let y=0; y<gridSize; y++) for (let x=0; x<gridSize; x++) if (shapePreview.grid[y][x]) l.grid[y][x] = shapePreview.grid[y][x]; shapePreview = null; renderMainGrid(); } if (currentTool==='select') { if (isSelecting) { isSelecting = false; createFloatingSelection(); } else if (isMoving) isMoving = false; } });
            window.addEventListener('keydown', e => { 
                if (e.target.tagName==='INPUT') return;
                if (e.code==='Space') { spacePressed = true; workspace.style.cursor = 'grab'; } 
                if (e.key==='?') { E('shortcuts-modal').classList.remove('hidden'); }
                if (e.key.toLowerCase()==='b') setTool('pen');
                if (e.key.toLowerCase()==='e') setTool('eraser');
                if (e.key.toLowerCase()==='g') setTool('bucket');
                if (e.ctrlKey && e.key.toLowerCase()==='z') undo();
            });
            window.addEventListener('keyup', e => { if (e.code==='Space') { spacePressed = false; workspace.style.cursor = 'default'; isPanning = false; } });
            workspace.addEventListener('wheel', e => { e.preventDefault(); if (e.ctrlKey || e.metaKey) { zoom *= (e.deltaY > 0 ? 0.9 : 1.1); zoom = Math.max(0.2, Math.min(zoom, 10)); updateTransform(); } else { panX -= e.deltaX; panY -= e.deltaY; updateTransform(); } });
            workspace.addEventListener('mousedown', e => { if (e.button===1 || spacePressed) { isPanning = true; workspace.style.cursor = 'grabbing'; e.preventDefault(); } });
            window.addEventListener('mousemove', e => { if (isPanning) { panX += e.movementX; panY += e.movementY; updateTransform(); } });
            
            // Touch support
            let touchDrawing = false;
            canvasContainer.addEventListener('touchstart', e => {
                if (e.touches.length > 1 || isPlaying || spacePressed) return;
                touchDrawing = true; const touch = e.touches[0]; const el = document.elementFromPoint(touch.clientX, touch.clientY);
                if (el && el.classList.contains('pixel-cell')) {
                    const x = parseInt(el.dataset.x), y = parseInt(el.dataset.y);
                    if (currentTool === 'text') { handleText(x, y); return; }
                    if (currentTool === 'select') { return; }
                    const l = frames[currentFrameIndex].layers[currentLayerIndex]; if (!l.visible) return;
                    if (['line', 'rect', 'circle'].includes(currentTool)) { shapeStart = {x, y}; shapePreview = { grid: createEmptyGrid() }; isDrawingShape = true; return; }
                    if (currentTool === 'outline') { applyOutline(); return; }
                    isDrawing = true; saveState(); useSecondary = false;
                    if ((currentTool === 'pen' || currentTool === 'eraser' || currentTool === 'burn' || currentTool === 'dodge') && isPixelPerfect) { currentStroke = []; backupGrid = JSON.parse(JSON.stringify(l.grid)); }
                    lastPos = {x, y}; handleInteract(x, y);
                }
            }, {passive: false});

            canvasContainer.addEventListener('touchmove', e => {
                if (!touchDrawing || isPlaying || spacePressed || e.touches.length > 1) return; e.preventDefault(); 
                const touch = e.touches[0]; const el = document.elementFromPoint(touch.clientX, touch.clientY);
                if (el && el.classList.contains('pixel-cell')) {
                    const x = parseInt(el.dataset.x), y = parseInt(el.dataset.y);
                    if (isDrawingShape) {
                        shapePreview.grid = createEmptyGrid();
                        getSymmetricPoints(shapeStart.x, shapeStart.y).forEach((sP, i) => { const eP = getSymmetricPoints(x, y)[i]; const drawC = useSecondary ? currentColorSec : currentColor; if (currentTool==='line') drawLineToGrid(sP.x, sP.y, eP.x, eP.y, drawC, shapePreview.grid); if (currentTool==='rect') drawRectToGrid(sP.x, sP.y, eP.x, eP.y, drawC, shapePreview.grid); if (currentTool==='circle') drawCircleToGrid(sP.x, sP.y, eP.x, eP.y, drawC, shapePreview.grid); }); renderMainGrid(); return;
                    }
                    if (isDrawing) { if (lastPos && ['pen','eraser','dither','burn','dodge'].includes(currentTool)) getBresenhamLine(lastPos.x, lastPos.y, x, y).forEach(p => handleInteract(p.x, p.y)); else handleInteract(x, y); lastPos = {x, y}; }
                }
            }, {passive: false});

            window.addEventListener('touchend', () => {
                touchDrawing = false; isDrawing = false; lastPos = null;
                if (isDrawingShape) { isDrawingShape = false; saveState(); const l = frames[currentFrameIndex].layers[currentLayerIndex]; for (let y=0; y<gridSize; y++) for (let x=0; x<gridSize; x++) if (shapePreview.grid[y][x]) l.grid[y][x] = shapePreview.grid[y][x]; shapePreview = null; renderMainGrid(); }
            });

            E('color-picker').addEventListener('input', e => setColor(e.target.value));
            E('color-picker-sec').addEventListener('input', e => { currentColorSec = e.target.value; updateColorHistory(e.target.value); });
            toolButtons.forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
            E('btn-clear').addEventListener('click', () => { if(confirm('Clear layer?')){commitAndClearSelection();saveState();frames[currentFrameIndex].layers[currentLayerIndex].grid=createEmptyGrid();renderMainGrid();} });
            E('btn-undo').addEventListener('click', undo); E('btn-add-frame').addEventListener('click', addFrame); E('btn-add-layer').addEventListener('click', () => { commitAndClearSelection(); saveState(); frames[currentFrameIndex].layers.push({ id:Date.now().toString(), name:`Layer ${frames[currentFrameIndex].layers.length+1}`, visible:true, opacity:1, blendMode:'normal', grid:createEmptyGrid() }); currentLayerIndex=frames[currentFrameIndex].layers.length-1; renderLayersPanel(); renderMainGrid(); });
            
            // Save/Load File
            E('btn-save-file').addEventListener('click', () => { commitAndClearSelection(); const b=new Blob([JSON.stringify({name: E('project-name').value, gridSize,fps,frames,RETRO_PALETTE})],{type:'application/json'}); const l=document.createElement('a'); l.href=URL.createObjectURL(b); l.download=`${E('project-name').value||'pixelstudio'}.pxl`; l.click(); });
            E('btn-load-file').addEventListener('click', () => E('file-load').click());
            E('file-load').addEventListener('change', e => { const f=e.target.files[0]; if(!f)return; const r=new FileReader(); r.onload=ev=>{try{const p=JSON.parse(ev.target.result);if(p.gridSize&&p.frames){loadProjectData(p); E('file-load').value='';}}catch(err){alert('Invalid .pxl file!');}}; r.readAsText(f); });
            E('project-name').addEventListener('blur', autoSaveProject);

            // Modals
            E('btn-shortcuts').addEventListener('click', () => { E('shortcuts-modal').classList.remove('hidden'); });
            E('btn-shortcuts-close').addEventListener('click', () => { E('shortcuts-modal').classList.add('hidden'); });
            
            E('btn-export-options').addEventListener('click', () => { E('export-modal').classList.remove('hidden'); });
            E('btn-export-close').addEventListener('click', () => { E('export-modal').classList.add('hidden'); });
            E('export-png').addEventListener('click', () => exportImage('png', parseInt(E('export-scale').value)));
            E('export-sheet-btn').addEventListener('click', () => exportImage('sheet', parseInt(E('export-scale').value)));
            E('export-svg').addEventListener('click', exportSVG);
            E('export-css').addEventListener('click', exportCSS);
            E('export-gif-btn').addEventListener('click', () => { commitAndClearSelection(); fetch('https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js').then(r=>r.text()).then(t=>{ const b=new Blob([t],{type:'application/javascript'}), w=URL.createObjectURL(b), sc=parseInt(E('export-scale').value), fs=gridSize*sc, gif=new GIF({workers:2,quality:10,width:fs,height:fs,workerScript:w,transparent:'rgba(0,0,0,0)'}); frames.forEach(f=>{const c=document.createElement('canvas');c.width=fs;c.height=fs;const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;for(let y=0;y<gridSize;y++)for(let x=0;x<gridSize;x++){const col=getCompositedColorRGB(frames.indexOf(f),x,y);if(col){ctx.fillStyle=col;ctx.fillRect(x*sc,y*sc,sc,sc);}}gif.addFrame(c,{delay:1000/fps});}); gif.on('finished',b=>{const l=document.createElement('a');l.download=`anim_${gridSize}px.gif`;l.href=URL.createObjectURL(b);l.click(); E('export-modal').classList.add('hidden');}); gif.render(); }); });

            // Brush
            E('brush-size').addEventListener('input', e => { brushSize = parseInt(e.target.value); E('brush-size-val').textContent = brushSize; });
            E('btn-shape-square').addEventListener('click', () => { brushShape='square'; E('btn-shape-square').className='w-5 h-5 bg-accent text-white rounded text-[10px] flex items-center justify-center transition-colors'; E('btn-shape-circle').className='w-5 h-5 bg-panel text-gray-400 hover:text-white rounded text-[10px] flex items-center justify-center transition-colors'; });
            E('btn-shape-circle').addEventListener('click', () => { brushShape='circle'; E('btn-shape-circle').className='w-5 h-5 bg-accent text-white rounded text-[10px] flex items-center justify-center transition-colors'; E('btn-shape-square').className='w-5 h-5 bg-panel text-gray-400 hover:text-white rounded text-[10px] flex items-center justify-center transition-colors'; });

            // Filters & Ref & Play & Toggle            E('btn-export-options').addEventListener('click', () => { E('export-modal').classList.remove('hidden'); });
            E('btn-export-close').addEventListener('click', () => { E('export-modal').classList.add('hidden'); });
            E('export-png').addEventListener('click', () => exportImage('png', parseInt(E('export-scale').value)));
            E('export-sheet-btn').addEventListener('click', () => exportImage('sheet', parseInt(E('export-scale').value)));
            E('export-svg').addEventListener('click', exportSVG);
            E('export-css').addEventListener('click', exportCSS);
            E('export-gif-btn').addEventListener('click', () => { commitAndClearSelection(); fetch('https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js').then(r=>r.text()).then(t=>{ const b=new Blob([t],{type:'application/javascript'}), w=URL.createObjectURL(b), sc=parseInt(E('export-scale').value), fs=gridSize*sc, gif=new GIF({workers:2,quality:10,width:fs,height:fs,workerScript:w,transparent:'rgba(0,0,0,0)'}); frames.forEach(f=>{const c=document.createElement('canvas');c.width=fs;c.height=fs;const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;for(let y=0;y<gridSize;y++)for(let x=0;x<gridSize;x++){const col=getCompositedColorRGB(frames.indexOf(f),x,y);if(col){ctx.fillStyle=col;ctx.fillRect(x*sc,y*sc,sc,sc);}}gif.addFrame(c,{delay:1000/fps});}); gif.on('finished',b=>{const l=document.createElement('a');l.download=`anim_${gridSize}px.gif`;l.href=URL.createObjectURL(b);l.click(); E('export-modal').classList.add('hidden');}); gif.render(); }); });

            // Quick Export Buttons
            E('btn-quick-png').addEventListener('click', () => exportImage('png', 8));
            E('btn-quick-gif').addEventListener('click', () => { commitAndClearSelection(); fetch('https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js').then(r=>r.text()).then(t=>{ const b=new Blob([t],{type:'application/javascript'}), w=URL.createObjectURL(b), sc=8, fs=gridSize*sc, gif=new GIF({workers:2,quality:10,width:fs,height:fs,workerScript:w,transparent:'rgba(0,0,0,0)'}); frames.forEach(f=>{const c=document.createElement('canvas');c.width=fs;c.height=fs;const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;for(let y=0;y<gridSize;y++)for(let x=0;x<gridSize;x++){const col=getCompositedColorRGB(frames.indexOf(f),x,y);if(col){ctx.fillStyle=col;ctx.fillRect(x*sc,y*sc,sc,sc);}}gif.addFrame(c,{delay:1000/fps});}); gif.on('finished',b=>{const l=document.createElement('a');l.download=`anim_${gridSize}px.gif`;l.href=URL.createObjectURL(b);l.click();}); gif.render(); }); });

            // Welcome Modal Handlers
            E('btn-new-drawing').addEventListener('click', () => {
                E('welcome-modal').classList.add('hidden');
                initData();
                setAppMode('drawing');
            });
            E('btn-new-animation').addEventListener('click', () => {
                E('welcome-modal').classList.add('hidden');
                initData();
                setAppMode('animation');
            });
            E('btn-mode').addEventListener('click', () => E('mode-modal').classList.remove('hidden'));
            // Mode modal controls
            document.querySelectorAll('.mode-option').forEach(btn => {
                btn.addEventListener('click', () => {
                    const mode = btn.dataset.mode;
                    if (mode === 'normal') {
                        // just close modal, stay in normal drawing
                        E('mode-modal').classList.add('hidden');
                    } else if (mode === 'upscale') {
                        E('mode-modal').classList.add('hidden');
                        alert('AI Pixel Upscaler coming soon!');
                        // placeholder for future implementation
                    } else if (mode === 'custombrush') {
                        E('mode-modal').classList.add('hidden');
                        alert('Custom Brush Maker coming soon!');
                    }
                });
            });
            E('mode-close').addEventListener('click', () => E('mode-modal').classList.add('hidden'));

        }

        function updateColorHistory(c) {
            c = c.toLowerCase(); if(!colorHistory.includes(c)) { colorHistory.unshift(c); if(colorHistory.length>8)colorHistory.pop(); updateColorHistoryUI(); }
        }
        function updateColorHistoryUI() {
            const h = E('color-history'); h.innerHTML='';
            colorHistory.forEach(c => { const d = document.createElement('div'); d.className='w-5 h-5 rounded shrink-0 cursor-pointer border border-[#3a3a44] shadow-sm hover:scale-110 transition-transform'; d.style.backgroundColor=c; d.onclick=()=>setColor(c); h.appendChild(d); });
        }
        function initPalette() { paletteGrid.innerHTML=''; RETRO_PALETTE.forEach(c => { const s=document.createElement('div');s.className='color-swatch';s.style.backgroundColor=c;s.dataset.color=c;if(c.toLowerCase()===currentColor.toLowerCase())s.classList.add('active');s.onclick=()=>setColor(c);paletteGrid.appendChild(s); }); }
        function setColor(c) { updateColorHistory(c); currentColor=c; E('color-picker').value=c;        const hexEl = E('color-hex');
        if (hexEl) hexEl.textContent = c.toUpperCase(); document.querySelectorAll('.color-swatch').forEach(s=>{s.classList.remove('active');if(s.dataset.color.toLowerCase()===c.toLowerCase())s.classList.add('active');}); const hex=hexToRgb(c), hHex="#"+[hex.r,hex.g,hex.b].map(x=>x.toString(16).padStart(2,'0')).join(''), hsl=hexToHSL(hHex), lg=HSLToHex(hsl.h,Math.max(0,hsl.s-5),Math.min(100,hsl.l+15)), dk=HSLToHex(hsl.h,Math.min(100,hsl.s+5),Math.max(0,hsl.l-15)); E('color-light').style.backgroundColor=lg; E('color-light').onclick=()=>setColor(lg); E('color-dark').style.backgroundColor=dk; E('color-dark').onclick=()=>setColor(dk); if(['eraser','select','magic-wand','replace-color'].includes(currentTool)) setTool('pen'); }
        function setTool(t) { if(floatingSelection&&t!=='select')commitSelection(); currentTool=t; toolButtons.forEach(b=>{const icon=b.querySelector('i'); if(b.dataset.tool===t){b.classList.add('active');if(icon){icon.classList.remove('text-gray-400','text-[#ff793f]','text-[#ffda79]');icon.classList.add('text-white');}}else{b.classList.remove('active');if(icon){icon.classList.remove('text-white');if(!icon.classList.contains('text-[#ff793f]')&&!icon.classList.contains('text-[#ffda79]'))icon.classList.add('text-gray-400');}}}); }
        function hexToHSL(hex) { let r=/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex), rC=parseInt(r[1],16)/255,gC=parseInt(r[2],16)/255,bC=parseInt(r[3],16)/255, mx=Math.max(rC,gC,bC), mn=Math.min(rC,gC,bC), h,s,l=(mx+mn)/2; if(mx===mn)h=s=0;else{let d=mx-mn;s=l>0.5?d/(2-mx-mn):d/(mx+mn);switch(mx){case rC:h=(gC-bC)/d+(gC<bC?6:0);break;case gC:h=(bC-rC)/d+2;break;case bC:h=(rC-gC)/d+4;break;}h/=6;} return {h:h*360,s:s*100,l:l*100}; }
        function HSLToHex(h,s,l) { s/=100;l/=100;let c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs((h/60)%2-1)), m=l-c/2, r=0,g=0,b=0; if(h<60){r=c;g=x;b=0;}else if(h<120){r=x;g=c;b=0;}else if(h<180){r=0;g=c;b=x;}else if(h<240){r=0;g=x;b=c;}else if(h<300){r=x;g=0;b=c;}else{r=c;g=0;b=x;} return `#${Math.round((r+m)*255).toString(16).padStart(2,'0')}${Math.round((g+m)*255).toString(16).padStart(2,'0')}${Math.round((b+m)*255).toString(16).padStart(2,'0')}`; }
        function rgbToHex(rgb) { const arr = rgb.match(/\d+/g); if(!arr)return '#000000'; return "#" + ((1<<24)+(parseInt(arr[0])<<16)+(parseInt(arr[1])<<8)+parseInt(arr[2])).toString(16).slice(1); }
        function hexToRgb(h) { const r=/^#?([a-f\d])([a-f\d])([a-f\d])$/i; h=h.replace(r,(m,r,g,b)=>r+r+g+g+b+b); const s=/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h); return s?{r:parseInt(s[1],16),g:parseInt(s[2],16),b:parseInt(s[3],16)}:{r:0,g:0,b:0}; }

        document.addEventListener('DOMContentLoaded', init);
