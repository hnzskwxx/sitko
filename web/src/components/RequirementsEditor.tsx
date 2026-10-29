import { ArrowDown, ArrowUp, Plus, Quote, Trash2, TriangleAlert, UserRound } from 'lucide-react';
import type { Requirement, RequirementCategory, RequirementSuggestion, Weight } from '@shared/types';
import { CATEGORY_LABEL, REQUIREMENT_CATEGORIES, WEIGHT_LABEL } from '@shared/types';
import { Button, IconButton, Input, Select } from './ui';

export interface DraftRequirement {
  key: string;
  id: string | null;
  name: string;
  description: string;
  category: RequirementCategory;
  weight: Weight;
  mustHave: boolean;
  origin: 'ai' | 'user';
  adQuote: string | null;
  sourceFound: boolean | null; // null = neznámé (uložený požadavek)
}

let seq = 0;
const key = () => `r${++seq}`;

export const fromRequirement = (r: Requirement): DraftRequirement => ({ ...r, key: key(), sourceFound: null });
export const fromSuggestion = (r: RequirementSuggestion): DraftRequirement => ({ ...r, id: null, key: key() });
export const emptyRequirement = (): DraftRequirement => ({
  key: key(), id: null, name: '', description: '', category: 'dovednosti', weight: 2, mustHave: false, origin: 'user', adQuote: null, sourceFound: null,
});

export const toPayload = (list: DraftRequirement[]) => list.map((r) => ({
  id: r.id, name: r.name.trim(), description: r.description.trim(), category: r.category, weight: r.weight,
  mustHave: r.mustHave, origin: r.origin, adQuote: r.adQuote,
}));

export function validateRequirements(list: DraftRequirement[]): string | null {
  if (!list.length) return 'Přidejte aspoň jeden požadavek.';
  if (list.some((r) => r.name.trim().length < 2)) return 'Každý požadavek musí mít název.';
  if (list.length > 20) return 'Nejvýš 20 požadavků.';
  return null;
}

export function RequirementsEditor({ value, onChange }: { value: DraftRequirement[]; onChange: (v: DraftRequirement[]) => void }) {
  const update = (k: string, patch: Partial<DraftRequirement>) => onChange(value.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...value];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };

  return (
    <div className="panel">
      <div className="req-list">
        {value.map((r, i) => (
          <div className="req" key={r.key}>
            <div className="req-fields">
              <Input
                aria-label={`Název požadavku ${i + 1}`} value={r.name} placeholder="Například: Praxe v nákupu 2+ roky"
                onChange={(e) => update(r.key, { name: e.target.value })} invalid={r.name.trim().length > 0 && r.name.trim().length < 2}
                style={{ fontWeight: 500 }}
              />
              <Input
                compact aria-label={`Co ověřit u požadavku ${i + 1}`} value={r.description} placeholder="Co přesně v životopise ověřit (nepovinné)"
                onChange={(e) => update(r.key, { description: e.target.value })}
              />
              <div className="req-meta">
                <Select compact aria-label="Důležitost" value={r.weight} onChange={(e) => update(r.key, { weight: Number(e.target.value) as Weight })}>
                  {([3, 2, 1] as Weight[]).map((w) => <option key={w} value={w}>{WEIGHT_LABEL[w]}</option>)}
                </Select>
                <Select compact aria-label="Kategorie" value={r.category} onChange={(e) => update(r.key, { category: e.target.value as RequirementCategory })}>
                  {REQUIREMENT_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                </Select>
                <label className="check-label">
                  <input type="checkbox" className="checkbox" checked={r.mustHave} onChange={(e) => update(r.key, { mustHave: e.target.checked })} />
                  Povinný
                </label>
              </div>
              {r.origin === 'ai' && r.adQuote && (
                <p className={`req-source${r.sourceFound === false ? ' is-missing' : ''}`}>
                  {r.sourceFound === false ? <TriangleAlert aria-hidden /> : <Quote aria-hidden />}
                  <span>
                    {r.sourceFound === false ? 'Citaci jsme v inzerátu nenašli, zkontrolujte, jestli požadavek opravdu platí: ' : 'Z inzerátu: '}
                    „{r.adQuote}“
                  </span>
                </p>
              )}
              {r.origin === 'user' && <p className="req-source"><UserRound aria-hidden />Přidáno ručně</p>}
            </div>
            <div className="req-actions">
              <IconButton label="Posunout výš" size="sm" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></IconButton>
              <IconButton label="Posunout níž" size="sm" disabled={i === value.length - 1} onClick={() => move(i, 1)}><ArrowDown /></IconButton>
              <IconButton label="Odebrat požadavek" size="sm" onClick={() => onChange(value.filter((x) => x.key !== r.key))}><Trash2 /></IconButton>
            </div>
          </div>
        ))}
      </div>
      <div style={{ padding: 12, borderTop: value.length ? '1px solid var(--border)' : undefined }}>
        <Button variant="ghost" size="sm" icon={<Plus />} onClick={() => onChange([...value, emptyRequirement()])}>Přidat požadavek</Button>
      </div>
    </div>
  );
}
