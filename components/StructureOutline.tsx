import React from 'react';
import { GraphicData, GraphicType } from '../types';

interface OutlineSection {
  title: string;
  points: string[];
}

interface Props {
  data: GraphicData;
}

const sanitizePoints = (items: unknown): string[] => {
  if (!Array.isArray(items)) return [];
  return items
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
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
          <div className="absolute -top-3 left-4">
            <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100">
              Section {index + 1}
            </span>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-6 rounded-full bg-indigo-400"></div>
            <p className="text-lg font-bold text-slate-800">{section.title}</p>
          </div>
          <ul className="space-y-2">
            {section.points.map((point, pointIndex) => (
              <li
                key={`${section.title}-${pointIndex}`}
                className="flex items-start gap-2 text-sm text-slate-700"
              >
                <span className="mt-1 inline-flex w-2 h-2 rounded-full bg-indigo-300"></span>
                <span className="flex-1 bg-slate-50/80 rounded-lg px-3 py-2 border border-slate-100 shadow-inner">
                  {point}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
};

export default StructureOutline;

