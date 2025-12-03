import React, { useState, useRef, useEffect } from 'react';
import { GraphicData, GraphicType } from '../types';
import { ZoomIn, ZoomOut, RotateCcw, Move } from 'lucide-react';

interface Props {
  data: GraphicData;
}

// --- Helper Components & Defs ---

const SvgDefs = () => (
  <defs>
    {/* Soft Drop Shadow */}
    <filter id="shadow-sm" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#1e293b" floodOpacity="0.08" />
    </filter>
    <filter id="shadow-card" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#64748b" floodOpacity="0.12" />
    </filter>
    
    {/* Gradients */}
    <linearGradient id="grad-indigo-soft" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stopColor="#e0e7ff" stopOpacity="0.6" />
      <stop offset="100%" stopColor="#c7d2fe" stopOpacity="0.2" />
    </linearGradient>
    
    <linearGradient id="grad-rose-soft" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stopColor="#ffe4e6" stopOpacity="0.6" />
      <stop offset="100%" stopColor="#fecdd3" stopOpacity="0.2" />
    </linearGradient>

    <linearGradient id="grad-blue-soft" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stopColor="#dbeafe" stopOpacity="0.6" />
      <stop offset="100%" stopColor="#bfdbfe" stopOpacity="0.2" />
    </linearGradient>

    <linearGradient id="grad-path" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stopColor="#818cf8" />
      <stop offset="50%" stopColor="#a78bfa" />
      <stop offset="100%" stopColor="#f472b6" />
    </linearGradient>
    
    <linearGradient id="grad-hub" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stopColor="#ffffff" />
      <stop offset="100%" stopColor="#f8fafc" />
    </linearGradient>
  </defs>
);

interface ForeignTextProps {
  x: number;
  y: number;
  width: number;
  height?: number;
  children?: React.ReactNode;
  className?: string;
}

const ForeignText = ({ x, y, width, height, children, className = '' }: ForeignTextProps) => (
  <foreignObject x={x} y={y} width={width} height={height || width} className="overflow-visible pointer-events-none">
    <div className={`w-full flex flex-col ${className}`}>
      {children}
    </div>
  </foreignObject>
);

// Helper to extract text from item (supports both old string format and new object format)
const extractItemText = (item: any): string => {
  if (typeof item === 'string') return item;
  if (typeof item === 'object' && item !== null && 'text' in item) {
    return typeof item.text === 'string' ? item.text : '';
  }
  return '';
};

const ListItems = ({ items, align = 'left', theme = 'indigo' }: { items: (string | { text: string; details?: string[] })[], align?: 'left' | 'center' | 'right', theme?: 'indigo' | 'rose' | 'blue' | 'slate' }) => {
  const colors = {
    indigo: "bg-indigo-50/90 border-indigo-100 text-indigo-800",
    rose: "bg-rose-50/90 border-rose-100 text-rose-800",
    blue: "bg-blue-50/90 border-blue-100 text-blue-800",
    slate: "bg-slate-50/90 border-slate-100 text-slate-700"
  };

  const detailColors = {
    indigo: "bg-indigo-100/60 border-indigo-200 text-indigo-700",
    rose: "bg-rose-100/60 border-rose-200 text-rose-700",
    blue: "bg-blue-100/60 border-blue-200 text-blue-700",
    slate: "bg-slate-100/60 border-slate-200 text-slate-600"
  };

  return (
    <div className={`flex flex-col gap-1.5 w-full ${align === 'center' ? 'items-center' : align === 'right' ? 'items-end' : 'items-start'}`}>
      {items?.map((item, i) => {
        const text = extractItemText(item);
        if (!text) return null;
        
        // Extract details if item is an object
        const details = typeof item === 'object' && item !== null && 'details' in item && Array.isArray(item.details) 
          ? item.details.filter((d: any) => d && typeof d === 'string' && d.trim().length > 0)
          : [];
        
        return (
          <div key={i} className={`flex flex-col gap-0.5 w-full ${align === 'center' ? 'items-center' : align === 'right' ? 'items-end' : 'items-start'}`}>
            <div className={`text-[11px] font-medium px-2 py-1 rounded-md border shadow-sm leading-tight backdrop-blur-sm ${colors[theme]}`}>
              {text}
            </div>
            {details.length > 0 && (
              <div className={`flex flex-wrap gap-1 ${align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : 'justify-start'}`}>
                {details.map((detail: string, j: number) => (
                  <span key={j} className={`text-[9px] px-1.5 py-0.5 rounded border ${detailColors[theme]}`}>
                    {detail}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// --- Specific Diagram Renderers ---

const VennDiagram = ({ content }: { content: any }) => {
  const width = 1000;
  const height = 600;
  const cx1 = 350;
  const cx2 = 650;
  const cy = 320;
  const r = 280;
  
  // Validate content - support both old (string) and new (object) formats
  const labelA = content.labelA || 'Topic A';
  const labelB = content.labelB || 'Topic B';
  const setA = Array.isArray(content.setA) ? content.setA.filter((i: any) => i && (typeof i === 'string' || (typeof i === 'object' && i !== null && 'text' in i))) : [];
  const setB = Array.isArray(content.setB) ? content.setB.filter((i: any) => i && (typeof i === 'string' || (typeof i === 'object' && i !== null && 'text' in i))) : [];
  const intersection = Array.isArray(content.intersection) ? content.intersection.filter((i: any) => i && (typeof i === 'string' || (typeof i === 'object' && i !== null && 'text' in i))) : [];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <SvgDefs />
      
      {/* Label A */}
      <ForeignText x={cx1 - 150} y={30} width={300} height={50} className="items-center justify-center">
         <div className="bg-indigo-100/80 text-indigo-800 px-4 py-1.5 rounded-full text-sm font-bold shadow-sm border border-indigo-200 backdrop-blur-md">
           {labelA}
         </div>
      </ForeignText>

      {/* Label B */}
      <ForeignText x={cx2 - 150} y={30} width={300} height={50} className="items-center justify-center">
         <div className="bg-rose-100/80 text-rose-800 px-4 py-1.5 rounded-full text-sm font-bold shadow-sm border border-rose-200 backdrop-blur-md">
           {labelB}
         </div>
      </ForeignText>

      <g filter="url(#shadow-sm)">
        {/* Circle A */}
        <circle cx={cx1} cy={cy} r={r} fill="url(#grad-indigo-soft)" stroke="#a5b4fc" strokeWidth="1.5" />
        
        {/* Circle B */}
        <circle cx={cx2} cy={cy} r={r} fill="url(#grad-rose-soft)" stroke="#fecdd3" strokeWidth="1.5" />
      </g>

      {/* Content A (Left) */}
      <ForeignText x={cx1 - 200} y={cy - 120} width={220} height={240} className="items-center justify-center">
        <ListItems items={setA} align="center" theme="indigo" />
      </ForeignText>

      {/* Content B (Right) */}
      <ForeignText x={cx2 - 20} y={cy - 120} width={220} height={240} className="items-center justify-center">
        <ListItems items={setB} align="center" theme="rose" />
      </ForeignText>

      {/* Intersection */}
      <ForeignText x={425} y={cy - 140} width={150} height={280} className="items-center justify-center pt-8">
         <div className="text-[10px] font-bold text-slate-400 uppercase mb-2 text-center tracking-widest bg-white/50 px-2 py-0.5 rounded-full">Shared</div>
         <ListItems items={intersection} align="center" theme="slate" />
      </ForeignText>
    </svg>
  );
};

const LinearDiagram = ({ content }: { content: any }) => {
  const steps = Array.isArray(content.steps) && content.steps.length > 0
    ? content.steps.filter((s: any) => {
        if (!s) return false;
        if (typeof s === 'string') return s.trim().length > 0;
        if (typeof s === 'object' && 'text' in s) return typeof s.text === 'string' && s.text.trim().length > 0;
        return false;
      })
    : [];
  
  if (steps.length === 0) {
    console.warn('LinearDiagram: No steps found in content', content);
  }
  
  const itemsPerRow = 3;
  const xGap = 320;
  const yGap = 280;
  const paddingX = 200;
  const paddingY = 120;
  
  const rows = Math.ceil(steps.length / itemsPerRow);
  const width = 1000;
  const height = Math.max(600, paddingY * 2 + (rows - 1) * yGap + 100);

  const getPos = (index: number) => {
    const row = Math.floor(index / itemsPerRow);
    const isEvenRow = row % 2 === 0;
    const col = index % itemsPerRow;
    const x = isEvenRow 
      ? paddingX + col * xGap 
      : paddingX + (itemsPerRow - 1 - col) * xGap;
    const y = paddingY + row * yGap;
    return { x, y, row };
  };

  let pathD = "";
  if (steps.length > 0) {
    const start = getPos(0);
    pathD = `M ${start.x} ${start.y}`;
    for (let i = 0; i < steps.length - 1; i++) {
      const curr = getPos(i);
      const next = getPos(i + 1);
      if (curr.row === next.row) {
        pathD += ` L ${next.x} ${next.y}`;
      } else {
        const isRightTurn = (curr.row % 2 === 0);
        const controlOffset = 180;
        const controlX = isRightTurn ? curr.x + controlOffset : curr.x - controlOffset;
        pathD += ` C ${controlX} ${curr.y}, ${controlX} ${next.y}, ${next.x} ${next.y}`;
      }
    }
  }

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <SvgDefs />
      
      {/* Background Path */}
      <path d={pathD} fill="none" stroke="url(#grad-path)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" filter="url(#shadow-sm)" opacity="0.5" />

      {steps.map((step: any, i: number) => {
        const { x, y } = getPos(i);
        const stepText = extractItemText(step);
        return (
          <g key={i}>
            {/* Node Marker */}
            <g filter="url(#shadow-sm)">
                <circle cx={x} cy={y} r="24" fill="white" stroke="#818cf8" strokeWidth="2" />
                <text x={x} y={y} dy="5" textAnchor="middle" className="text-sm font-bold fill-indigo-600 font-sans">{i + 1}</text>
            </g>
            
            {/* Content Card */}
            <ForeignText x={x - 120} y={y + 35} width={240} height={180} className="items-center">
              <div className="relative w-full">
                  {/* Little arrow pointing up */}
                  <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-t border-l border-slate-100 transform rotate-45 z-10"></div>
                  
                  <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 text-sm text-center w-full leading-relaxed font-medium text-slate-700 relative z-0">
                    <div className="mb-2">{stepText}</div>
                    {typeof step === 'object' && step !== null && 'details' in step && Array.isArray(step.details) && step.details.length > 0 && (
                      <div className="flex flex-wrap gap-1 justify-center mt-2">
                        {step.details.filter((d: any) => d && typeof d === 'string' && d.trim().length > 0).map((detail: string, j: number) => (
                          <span key={j} className="text-[9px] px-1.5 py-0.5 rounded border bg-indigo-100/60 border-indigo-200 text-indigo-700">
                            {detail}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
              </div>
            </ForeignText>
          </g>
        );
      })}
    </svg>
  );
};

const CircleDiagram = ({ content }: { content: any }) => {
  const width = 1000;
  const height = 900;
  const cx = width / 2;
  const cy = height / 2;
  const radius = 240; // 减小半径，让线更短
  const centerRadius = 100; // 中心圆半径
  const nodeRadius = 60; // 节点圆半径
  
  // Validate and get nodes - support both old (string) and new (object) formats
  const nodes = Array.isArray(content.nodes) && content.nodes.length > 0 
    ? content.nodes.filter((n: any) => {
        if (!n) return false;
        if (typeof n === 'string') return n.trim().length > 0;
        if (typeof n === 'object' && 'text' in n) return typeof n.text === 'string' && n.text.trim().length > 0;
        return false;
      })
    : [];
  
  // Debug log
  if (nodes.length === 0) {
    console.warn('CircleDiagram: No nodes found in content', content);
  }
  
  const angleStep = nodes.length > 0 ? (2 * Math.PI) / nodes.length : 0;
  const centerText = content.center || 'Focus Topic';

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <SvgDefs />
      
      {/* Orbit Ring */}
      {nodes.length > 0 && (
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#e2e8f0" strokeWidth="1" strokeDasharray="8,8" />
      )}

      {/* Center Hub */}
      <g filter="url(#shadow-card)">
        <circle cx={cx} cy={cy} r={centerRadius} fill="url(#grad-hub)" stroke="#818cf8" strokeWidth="1" />
        <circle cx={cx} cy={cy} r="94" fill="url(#grad-indigo-soft)" />
      </g>
      
      <ForeignText x={cx - 80} y={cy - 80} width={160} height={160} className="justify-center items-center text-center pointer-events-none">
         <div className="flex flex-col items-center justify-center h-full">
           <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-1">Focus Topic</span>
           <span className="font-bold text-lg text-indigo-900 leading-tight drop-shadow-sm">{centerText}</span>
         </div>
      </ForeignText>

      {/* Satellites */}
      {nodes.length > 0 ? (
        nodes.map((node: any, i: number) => {
          const angle = i * angleStep - Math.PI / 2;
          const nx = cx + radius * Math.cos(angle);
          const ny = cy + radius * Math.sin(angle);
          const nodeText = extractItemText(node);
          
          // 计算连接线的起点和终点（从中心圆边缘到节点圆边缘）
          const lineStartX = cx + centerRadius * Math.cos(angle);
          const lineStartY = cy + centerRadius * Math.sin(angle);
          const lineEndX = nx - nodeRadius * Math.cos(angle);
          const lineEndY = ny - nodeRadius * Math.sin(angle);
          
          return (
            <g key={i}>
              {/* Connector - 从中心圆边缘到节点圆边缘 */}
              <line x1={lineStartX} y1={lineStartY} x2={lineEndX} y2={lineEndY} stroke="#cbd5e1" strokeWidth="4" opacity="0.7" />
              
              {/* Node */}
              <g filter="url(#shadow-sm)">
                  <circle cx={nx} cy={ny} r={nodeRadius} fill="white" stroke="#f472b6" strokeWidth="2" />
              </g>
              
              <ForeignText x={nx - 60} y={ny - 60} width={120} height={120} className="justify-center items-center text-center">
                <div className="flex flex-col gap-1 items-center">
                  <span className="text-xs font-medium text-slate-700 leading-tight">{nodeText}</span>
                  {typeof node === 'object' && node !== null && 'details' in node && Array.isArray(node.details) && node.details.length > 0 && (
                    <div className="flex flex-wrap gap-0.5 justify-center">
                      {node.details.filter((d: any) => d && typeof d === 'string' && d.trim().length > 0).map((detail: string, j: number) => (
                        <span key={j} className="text-[8px] px-1 py-0.5 rounded border bg-rose-100/60 border-rose-200 text-rose-700">
                          {detail}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </ForeignText>
            </g>
          );
        })
      ) : (
        // Show placeholder message if no nodes
        <ForeignText x={cx - 150} y={cy + 150} width={300} height={50} className="justify-center items-center text-center">
          <div className="text-xs text-slate-400 italic">
            No nodes available. The AI may not have generated content for this organizer.
          </div>
        </ForeignText>
      )}
    </svg>
  );
};

// Visual Style: Cluster / Mind Map (Replaces Fishbone)
const FishboneDiagram = ({ content }: { content: any }) => {
  const ribs = Array.isArray(content.ribs) && content.ribs.length > 0
    ? content.ribs.filter((r: any) => {
        if (!r || typeof r !== 'object') return false;
        if (!r.category) return false;
        if (!Array.isArray(r.items)) return false;
        // Filter out empty items
        return r.items.some((item: any) => {
          if (typeof item === 'string') return item.trim().length > 0;
          if (typeof item === 'object' && 'text' in item) return typeof item.text === 'string' && item.text.trim().length > 0;
          return false;
        });
      })
    : [];
  
  if (ribs.length === 0) {
    console.warn('FishboneDiagram: No ribs found in content', content);
  }
  
  const width = 1000;
  const height = 900;
  const cx = width / 2;
  const cy = height / 2;
  const orbitR = 340;
  
  const angleStep = ribs.length > 0 ? (2 * Math.PI) / ribs.length : 0;
  const headText = content.head || 'Focus Topic';

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <SvgDefs />

       {/* Connections */}
       {ribs.map((_: any, i: number) => {
         const angle = i * angleStep - Math.PI / 2;
         const nx = cx + orbitR * Math.cos(angle);
         const ny = cy + orbitR * Math.sin(angle);
         return <line key={`line-${i}`} x1={cx} y1={cy} x2={nx} y2={ny} stroke="#e2e8f0" strokeWidth="2" />;
       })}

       {/* Central Problem */}
       <g filter="url(#shadow-card)">
         <circle cx={cx} cy={cy} r="100" fill="white" stroke="#ef4444" strokeWidth="2" />
         <circle cx={cx} cy={cy} r="92" fill="url(#grad-rose-soft)" />
       </g>
       <ForeignText x={cx - 85} y={cy - 85} width={170} height={170} className="justify-center items-center text-center">
          <span className="text-[10px] font-bold text-rose-400 uppercase tracking-widest mb-1">Focus Topic</span>
          <div className="font-bold text-base text-slate-800 leading-tight">{headText}</div>
       </ForeignText>

       {/* Category Clusters */}
       {ribs.length > 0 ? ribs.map((rib: any, i: number) => {
         const angle = i * angleStep - Math.PI / 2;
         const nx = cx + orbitR * Math.cos(angle);
         const ny = cy + orbitR * Math.sin(angle);
         
         return (
           <g key={i}>
             {/* Category Node Background (Invisible hit area mostly, visualized by the card) */}
             
             {/* We render a "Card" at the node position */}
             <ForeignText x={nx - 100} y={ny - 80} width={200} height={200} className="justify-start items-center">
                 <div className="w-full bg-white rounded-xl shadow-md border border-slate-100 p-3 flex flex-col gap-2 relative">
                    {/* Dot connection point */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 bg-blue-400 rounded-full -z-10 opacity-0"></div>
                    
                    <div className="text-center border-b border-slate-50 pb-2 mb-1">
                        <span className="text-xs font-bold text-blue-600 uppercase tracking-wide block">{rib.category}</span>
                    </div>
                    <ListItems items={rib.items} align="left" theme="blue" />
                 </div>
             </ForeignText>
           </g>
         )
       }) : (
         // Show placeholder if no ribs
         <ForeignText x={cx - 150} y={cy + 150} width={300} height={50} className="justify-center items-center text-center">
           <div className="text-xs text-slate-400 italic">
             No categories available. The AI may not have generated content for this organizer.
           </div>
         </ForeignText>
       )}
    </svg>
  );
};

// --- Main Component ---

const GraphicOrganizer: React.FC<Props> = ({ data }) => {
  const [scale, setScale] = useState(0.6);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  
  useEffect(() => {
    setScale(0.6); 
    setPosition({ x: 0, y: 0 });
  }, [data]);

  const renderContent = () => {
    switch (data.type) {
      case GraphicType.VENN:
        return <VennDiagram content={data.content} />;
      case GraphicType.LINEAR:
        return <LinearDiagram content={data.content} />;
      case GraphicType.CIRCLE:
        return <CircleDiagram content={data.content} />;
      case GraphicType.FISHBONE:
        return <FishboneDiagram content={data.content} />;
      default:
        return <div className="p-10 text-center text-slate-400">Unknown graphic type</div>;
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      e.preventDefault();
      setPosition({
        x: e.clientX - dragStart.current.x,
        y: e.clientY - dragStart.current.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Touch Handlers for Mobile Panning
  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    const touch = e.touches[0];
    dragStart.current = { x: touch.clientX - position.x, y: touch.clientY - position.y };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isDragging) {
      const touch = e.touches[0];
      setPosition({
        x: touch.clientX - dragStart.current.x,
        y: touch.clientY - dragStart.current.y
      });
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setScale(s => Math.min(Math.max(0.2, s + delta), 3));
    }
  };

  return (
    <div className="w-full h-[600px] bg-slate-50/50 relative overflow-hidden border border-slate-200 rounded-xl group">
      {/* Toolbar */}
      <div className="absolute top-4 right-4 z-20 flex flex-col gap-2 bg-white/90 backdrop-blur-sm p-1.5 rounded-lg shadow-lg border border-slate-100/50 opacity-80 group-hover:opacity-100 transition-opacity">
         <button 
            onClick={() => setScale(s => Math.min(s + 0.1, 3))} 
            className="p-2 hover:bg-slate-50 rounded-md text-slate-600 transition-colors" 
            title="Zoom In"
         >
            <ZoomIn className="w-4 h-4" />
         </button>
         <button 
            onClick={() => setScale(s => Math.max(s - 0.1, 0.2))} 
            className="p-2 hover:bg-slate-50 rounded-md text-slate-600 transition-colors" 
            title="Zoom Out"
         >
            <ZoomOut className="w-4 h-4" />
         </button>
         <button 
            onClick={() => { setScale(0.6); setPosition({x:0, y:0}); }} 
            className="p-2 hover:bg-slate-50 rounded-md text-slate-600 transition-colors" 
            title="Reset View"
         >
            <RotateCcw className="w-4 h-4" />
         </button>
         <div className="h-px bg-slate-200 my-1"></div>
         <div className="p-2 text-slate-400 flex justify-center cursor-grab" title="Drag to pan">
            <Move className="w-4 h-4" />
         </div>
      </div>

      {/* Title */}
      <div className="absolute top-4 left-4 z-20 pointer-events-none">
        <span className="text-[10px] font-bold px-3 py-1.5 bg-white/80 backdrop-blur text-slate-600 border border-slate-200 rounded-full shadow-sm uppercase tracking-wider flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></div>
          {data.title || 'Graphic Organizer'}
        </span>
      </div>
      
      {/* Canvas Area */}
      <div 
        className={`w-full h-full overflow-hidden bg-[url('https://www.transparenttextures.com/patterns/graphy.png')] flex items-center justify-center ${isDragging ? 'cursor-grabbing' : 'cursor-grab'} touch-none`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onWheel={handleWheel}
      >
         <div 
           style={{ 
             transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`, 
             transition: isDragging ? 'none' : 'transform 0.15s ease-out'
           }}
           className="origin-center will-change-transform"
         >
             {renderContent()}
         </div>
      </div>
    </div>
  );
};

export default GraphicOrganizer;