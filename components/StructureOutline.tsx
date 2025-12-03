import React from 'react';
import { GraphicData, GraphicType } from '../types';

interface Subpoint {
  text: string;
  details?: string[];
}

interface OutlineSection {
  title: string;
  points: Subpoint[];
}

interface Props {
  data: GraphicData;
}

const sanitizePoints = (items: unknown): Subpoint[] => {
  if (!Array.isArray(items)) return [];
  return items
    .map(item => {
      // New format: object with text and details
      if (typeof item === 'object' && item !== null && 'text' in item) {
        const text = typeof item.text === 'string' ? item.text.trim() : '';
        if (!text) return null;
        const details = Array.isArray(item.details) 
          ? item.details.map((d: any) => typeof d === 'string' ? d.trim() : '').filter(Boolean)
          : [];
        return { text, details };
      }
      // Old format: just a string (backward compatibility)
      if (typeof item === 'string') {
        const trimmed = item.trim();
        return trimmed ? { text: trimmed, details: [] } : null;
      }
      return null;
    })
    .filter((item): item is Subpoint => item !== null);
};

const buildSections = (data: GraphicData): OutlineSection[] => {
  if (!data?.content) return [];
  const { content, title } = data;

  switch (data.type) {
    case GraphicType.LINEAR: {
      const steps = sanitizePoints(content.steps);
      return steps.map((step, index) => ({
        title: `Step ${index + 1}`,
        points: [step],
      }));
    }
    case GraphicType.VENN: {
      const setA = sanitizePoints(content.setA);
      const setB = sanitizePoints(content.setB);
      const overlap = sanitizePoints(content.intersection);
      const sections: OutlineSection[] = [];
      if (setA.length) {
        sections.push({
          title: content.labelA || 'Topic A',
          points: setA,
        });
      }
      if (setB.length) {
        sections.push({
          title: content.labelB || 'Topic B',
          points: setB,
        });
      }
      if (overlap.length) {
        sections.push({
          title: 'Shared Ideas',
          points: overlap,
        });
      }
      return sections;
    }
    case GraphicType.CIRCLE: {
      const nodes = sanitizePoints(content.nodes);
      if (!nodes.length) return [];
      return [
        {
          title: content.center || title || 'Main Idea',
          points: nodes,
        },
      ];
    }
    case GraphicType.FISHBONE: {
      if (!Array.isArray(content.ribs)) return [];
      return content.ribs
        .filter(
          (rib: any) =>
            rib &&
            typeof rib === 'object' &&
            typeof rib.category === 'string' &&
            sanitizePoints(rib.items).length
        )
        .map((rib: any) => ({
          title: rib.category.trim(),
          points: sanitizePoints(rib.items),
        }));
    }
    default:
      return [
        {
          title: title || 'Outline',
          points: [],
        },
      ];
  }
};

const StructureOutline: React.FC<Props> = ({ data }) => {
  const sections = buildSections(data);

  if (!sections.length) {
    return (
      <div className="p-6 text-center text-slate-400">
        Outline not available for this organizer.
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-b from-white to-slate-50 rounded-2xl border border-slate-200 shadow-lg p-6 space-y-6 h-[600px] overflow-y-auto">
      {sections.map((section, index) => (
        <div
          key={`${section.title}-${index}`}
          className="relative bg-white border border-slate-100 rounded-2xl p-5 shadow-sm"
        >
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-6 rounded-full bg-indigo-400"></div>
            <p className="text-lg font-bold text-slate-800">{section.title}</p>
          </div>
          <ul className="space-y-3">
            {section.points.map((point, pointIndex) => (
              <li
                key={`${section.title}-${pointIndex}`}
                className="flex items-start gap-2 text-sm text-slate-700"
              >
                <span className="mt-1 inline-flex w-2 h-2 rounded-full bg-indigo-300 flex-shrink-0"></span>
                <div className="flex-1 space-y-2">
                  <div className="bg-slate-50/80 rounded-lg px-3 py-2 border border-slate-100 shadow-inner">
                    {point.text}
                  </div>
                  {point.details && point.details.length > 0 && (
                    <ul className="ml-4 space-y-1">
                      {point.details.map((detail, detailIndex) => (
                        <li
                          key={`${section.title}-${pointIndex}-${detailIndex}`}
                          className="text-xs text-slate-600 flex items-start gap-2"
                        >
                          <span className="mt-1.5 inline-flex w-1.5 h-1.5 rounded-full bg-indigo-200 flex-shrink-0"></span>
                          <span className="flex-1">{detail}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
};

export default StructureOutline;

