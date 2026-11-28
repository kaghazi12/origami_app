import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { FileUp, FolderOpen, ListOrdered, Upload } from 'lucide-react';
import { TopBar } from '../components/shell/TopBar';
import { StepEditor } from '../components/editor/StepEditor';
import { blankDesign } from '../components/editor/actions';
import { DesignCard } from '../components/community/DesignCard';
import { loadDesign } from '../components/community/designFiles';
import { Button, ButtonLink } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { TextArea, TextField } from '../components/ui/Field';
import { Reveal } from '../components/ui/Motion';
import { CreaseThumbnail } from '../components/ui/Thumbnails';
import { useToast } from '../components/ui/Toast';
import { parseDesign, type OrigamiDesign } from '../engine/design';
import { prepareFold } from '../engine/fold/prepare';
import { db, useDb, LIMITS, StoreError, type DesignRecord } from '../store';
import { ROUTE_HASH, href, navigate, usePageTitle } from '../router';

/** Read a .json step design or a .fold crease pattern and keep it as a new draft. */
async function importFile(file: File): Promise<DesignRecord> {
  if (file.size > LIMITS.designBytes) throw new StoreError(`This file is ${Math.round(file.size / 1000)} KB; designs can be at most ${LIMITS.designBytes / 1000} KB here.`);
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    throw new StoreError(`${file.name} isn’t valid JSON. Open a .json step design or a .fold crease pattern.`);
  }
  const base = file.name.replace(/\.[^.]+$/, '');
  const isFold = /\.fold$/i.test(file.name) || (typeof json === 'object' && json !== null && 'vertices_coords' in json);
  if (isFold) {
    let creases = 0;
    let title = base;
    try {
      const { fold, report } = prepareFold(json);
      creases = fold.edges_assignment.filter((a) => a === 'M' || a === 'V').length;
      title = report.title ?? base;
    } catch (e) {
      throw new StoreError(`${file.name} can’t be opened as a crease pattern: ${(e as Error).message}`);
    }
    return db.createDesign({ kind: 'pattern', title: title.slice(0, LIMITS.titleLength), source: { type: 'inline', data: json }, size: creases });
  }
  let design: OrigamiDesign;
  try {
    design = parseDesign(json);
  } catch (e) {
    throw new StoreError(`${file.name} isn’t a step design: ${(e as Error).message}`);
  }
  return db.createDesign({
    kind: 'steps',
    title: (design.meta.title || base).slice(0, LIMITS.titleLength),
    description: design.meta.description?.slice(0, LIMITS.descriptionLength),
    credit: design.meta.author,
    difficulty: design.meta.difficulty,
    tags: (design.meta.tags ?? []).slice(0, LIMITS.tags),
    source: { type: 'inline', data: design },
    size: design.steps.length,
    front: design.paper.front,
    back: design.paper.back,
  });
}

/** What to make: a new step-by-step design, or a file to upload. Plus your drafts. */
const Start: React.FC = () => {
  const toast = useToast();
  const me = useDb((d) => d.me)!;
  const drafts = useDb((d) => d.designs({ authorId: me.id, includeDrafts: true }).filter((x) => x.status === 'draft'));
  const input = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const fromFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const rec = await importFile(f);
      toast.show({ title: `${rec.title} is in your drafts` });
      navigate(href.edit(rec.id));
    } catch (e) {
      toast.show({ tone: 'error', title: 'Couldn’t open that file', detail: (e as Error).message });
    }
  };

  return (
    <main className="mx-auto max-w-5xl px-6 pb-24 pt-14">
      <Reveal>
        <h1 className="font-display text-4xl font-semibold tracking-tight text-ink lg:text-5xl">Make a design</h1>
        <p className="mt-3 max-w-xl text-ink-muted">Draw each fold on the model and watch it fold in 3D as you go. Drafts save as you work; publish when it’s ready.</p>
      </Reveal>
      <div className="mt-10 grid gap-5 md:grid-cols-2">
        <Reveal delay={0.05}>
          <button
            type="button"
            onClick={() => {
              try {
                const rec = db.createDesign({ kind: 'steps', title: 'Untitled design', source: { type: 'inline', data: null }, size: 0 });
                db.updateDesign(rec.id, { source: { type: 'inline', data: blankDesign(rec.id) } });
                navigate(href.edit(rec.id));
              } catch (e) {
                toast.show({ tone: 'error', title: (e as Error).message });
              }
            }}
            className="group relative flex h-full w-full flex-col overflow-hidden rounded-lg border border-line bg-surface-raised p-7 text-left transition-[border-color,box-shadow,translate] duration-200 hover:-translate-y-1 hover:border-line-strong hover:shadow-float focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60"
          >
            <span className="dog-ear" aria-hidden="true" style={{ ['--dog-ear-behind' as string]: 'var(--color-canvas)' }} />
            <ListOrdered className="size-6 text-ink" strokeWidth={1.75} />
            <span className="mt-4 font-display text-2xl font-semibold tracking-tight text-ink">Step-by-step design</span>
            <span className="mt-2 text-sm leading-relaxed text-ink-muted">Start from a square (or A4) sheet and add folds one at a time, with an instruction for each. Shows up in Learn.</span>
          </button>
        </Reveal>
        <Reveal delay={0.1}>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); fromFile(e.dataTransfer.files?.[0]); }}
            className={`flex h-full flex-col rounded-lg border-2 border-dashed p-7 transition-colors duration-150 ${dragOver ? 'border-focus bg-surface' : 'border-line-strong'}`}
          >
            <FileUp className="size-6 text-ink" strokeWidth={1.75} />
            <span className="mt-4 font-display text-2xl font-semibold tracking-tight text-ink">Upload a file</span>
            <span className="mt-2 text-sm leading-relaxed text-ink-muted">A crease pattern (.fold) or a step design (.json). Drop it here or choose it.</span>
            <div className="mt-5">
              <Button icon={Upload} onClick={() => input.current?.click()}>
                Choose a file
              </Button>
              <input ref={input} type="file" accept=".fold,.json,application/json" className="hidden" onChange={(e) => { fromFile(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
          </div>
        </Reveal>
      </div>

      {drafts.length > 0 && (
        <section className="mt-14" aria-labelledby="drafts">
          <h2 id="drafts" className="font-display text-2xl font-semibold tracking-tight text-ink">
            Your drafts
          </h2>
          <ul className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {drafts.map((d) => (
              <li key={d.id}>
                <DesignCard design={d} showAuthor={false} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
};

/** A crease pattern you uploaded: its words, its file check, and publishing. */
const PatternEditor: React.FC<{ record: DesignRecord }> = ({ record }) => {
  const toast = useToast();
  const loaded = useMemo(() => loadDesign(record), [record]);
  const [title, setTitle] = useState(record.title);
  const [description, setDescription] = useState(record.description);
  const [credit, setCredit] = useState(record.credit ?? '');
  const [tags, setTags] = useState(record.tags.join(', '));
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = window.setTimeout(() => {
      try {
        db.updateDesign(record.id, {
          title: title || 'Untitled pattern',
          description,
          credit: credit.trim() || undefined,
          tags: tags.split(',').map((x) => x.trim()).filter(Boolean).slice(0, LIMITS.tags),
        });
      } catch (e) {
        toast.show({ tone: 'error', title: (e as Error).message });
      }
    }, 500);
    return () => window.clearTimeout(t);
  }, [title, description, credit, tags, record.id, toast]);

  const fold = loaded.kind === 'pattern' ? loaded.fold : null;
  const report = loaded.kind === 'pattern' ? loaded.report : null;
  const problems = report?.issues.filter((i) => i.kind === 'impossible') ?? [];

  return (
    <main className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-10 px-6 pb-24 pt-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex aspect-square items-center justify-center rounded-lg bg-viewer p-8">
        {fold ? <CreaseThumbnail fold={fold} className="size-full" title="Crease pattern" /> : <Callout tone="danger" title="This file can’t be opened">{loaded.error}</Callout>}
      </motion.div>
      <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.06 }} className="space-y-5">
        <p className="text-sm text-ink-muted">Crease pattern · {record.size.toLocaleString()} creases · {record.status === 'draft' ? 'draft' : 'published'}</p>
        <TextField label="Title" value={title} maxCount={LIMITS.titleLength} onChange={(e) => setTitle(e.target.value)} />
        <TextArea label="Description" value={description} maxCount={LIMITS.descriptionLength} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="What it folds into, and any tips" />
        <TextField label="Designed by" value={credit} onChange={(e) => setCredit(e.target.value)} hint="Leave empty if it’s your own design." />
        <TextField label="Tags" value={tags} onChange={(e) => setTags(e.target.value)} hint="Separate with commas" />
        {problems.length > 0 && (
          <Callout title="The file check found problems">
            {problems.map((p) => p.title).join(' ')} Open it in Crease pattern mode to see the details.
          </Callout>
        )}
        <div className="flex flex-wrap gap-2 border-t border-line pt-5">
          <ButtonLink href={href.creasePattern(record.id)} icon={FolderOpen}>
            Fold it
          </ButtonLink>
          {record.status === 'published' ? (
            <ButtonLink href={href.design(record.id)} variant="primary">
              View page
            </ButtonLink>
          ) : (
            <Button
              variant="primary"
              icon={Upload}
              disabled={!fold}
              onClick={() => {
                try {
                  db.updateDesign(record.id, { title: title || 'Untitled pattern', description, credit: credit.trim() || undefined });
                  db.publish(record.id);
                  toast.show({ title: 'Published', detail: 'It’s in Explore and on your profile.' });
                  navigate(href.design(record.id));
                } catch (e) {
                  toast.show({ tone: 'error', title: (e as Error).message });
                }
              }}
            >
              Publish
            </Button>
          )}
        </div>
      </motion.div>
    </main>
  );
};

export const CreatePage: React.FC<{ id?: string }> = ({ id }) => {
  const me = useDb((d) => d.me);
  const record = useDb((d) => (id ? d.design(id) : null));
  usePageTitle(record ? `Editing ${record.title}` : 'Create');

  const initial = useMemo(() => {
    if (!record || record.kind !== 'steps') return null;
    try {
      const data = db.fileOf(record);
      return { design: data ? parseDesign(data) : blankDesign(record.id, record.title), error: null as string | null };
    } catch (e) {
      return { design: null, error: (e as Error).message };
    }
    // only when opening a different design: the editor owns the document after that
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.id]);

  const shell = (children: React.ReactNode, full = false) => (
    <div className={full ? 'flex h-dvh flex-col overflow-hidden bg-canvas' : 'min-h-dvh bg-canvas'}>
      <TopBar route="create" className={full ? undefined : 'sticky top-0 z-40'} />
      {children}
    </div>
  );

  if (!me) {
    return shell(
      <main className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">Sign in to make designs</h1>
        <p className="mt-3 text-ink-muted">Your drafts are kept with your profile, so they’re there when you come back.</p>
        <ButtonLink href={href.signin(window.location.hash)} variant="primary" className="mt-6">
          Sign in
        </ButtonLink>
      </main>,
    );
  }
  if (!id) return shell(<Start />);
  if (!record || record.authorId !== me.id) {
    return shell(
      <main className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">You can’t edit this design</h1>
        <p className="mt-3 text-ink-muted">It belongs to someone else, or it was deleted. Remix it from its page to make your own copy.</p>
        <ButtonLink href={ROUTE_HASH.create} className="mt-6">
          Make a design
        </ButtonLink>
      </main>,
    );
  }
  if (record.kind === 'pattern') return shell(<PatternEditor record={record} />);
  if (!initial?.design) {
    return shell(
      <main className="mx-auto max-w-lg px-6 py-24">
        <Callout tone="danger" title="This design’s file can’t be opened">
          {initial?.error}
        </Callout>
      </main>,
    );
  }
  return shell(<StepEditor key={record.id} record={record} initial={initial.design} />, true);
};
