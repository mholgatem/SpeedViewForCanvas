// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { detectKind } from '../src/render/detect';
import { autoNumber, paragraphsText, readPresentation, type Block } from '../src/render/pptx';
import { DISCLAIMER, renderSlidesView } from '../src/viewer/slides';
import { makePptx } from './helpers/pptx';

const texts = (blocks: Block[]) =>
  blocks.map((b) => (b.kind === 'text' ? paragraphsText(b.paragraphs) : b.kind === 'image' ? `[image ${b.part ?? b.label}]` : `[${b.kind}]`));
type TextBlock = Extract<Block, { kind: 'text' }>;

describe('readPresentation', () => {
  const pres = readPresentation(makePptx());
  const [slide1, slide2, slide3, slide4] = pres.slides;

  it('lists slides in order with titles and hidden flags', () => {
    expect(pres.slides.map((s) => [s.number, s.title, s.hidden])).toEqual([
      [1, 'Lab 3 Results', false],
      [2, 'Data', false],
      [3, 'Backup', true],
      [4, 'Gallery', false],
    ]);
    expect([pres.width, pres.height]).toEqual([12192000, 6858000]);
  });

  it('puts content in reading order: title, then top to bottom, left to right', () => {
    expect(texts(slide1!.blocks)).toEqual([
      'Lab 3 Results',
      'Measured voltage within 5% See the docs or this',
      '[image ppt/media/image1.png]',
      'First step Second step',
      'y=x2',
      // Text just under a picture counts as its caption.
      '[image Linked image (not loaded: it lives outside the file)]',
      'Footnote text',
      '[image Image in EMF format (can’t be shown in the browser)]',
    ]);
    // Inside a group, positions are mapped through the group's transform.
    expect(texts(slide3!.blocks)).toEqual(['Backup', 'Grouped note']);
  });

  it('reads bullets from the master, levels, numbering, and run formatting', () => {
    const body = slide1!.blocks[1] as TextBlock;
    expect(body.paragraphs.map((p) => [p.bullet, p.level])).toEqual([['•', 0], ['•', 1], ['•', 0]]);
    expect(body.paragraphs[0]!.runs[1]).toMatchObject({ text: 'voltage', bold: true });
    const title = slide1!.blocks[0] as TextBlock;
    expect(title.role).toBe('title');
    expect(title.paragraphs[0]!.bullet).toBeUndefined();
    const numbered = slide1!.blocks[3] as TextBlock;
    expect(numbered.paragraphs.map((p) => p.bullet)).toEqual(['1.', '2.']);
    const footnote = slide1!.blocks[6] as TextBlock;
    expect(footnote.paragraphs[0]!.bullet).toBeUndefined(); // text boxes don't inherit bullets
  });

  it('keeps only web and mail links', () => {
    const body = slide1!.blocks[1] as TextBlock;
    const runs = body.paragraphs[2]!.runs;
    expect(runs.find((r) => r.text === 'the docs')?.href).toBe('https://example.com/docs');
    expect(runs.find((r) => r.text === 'this')?.href).toBeUndefined();
  });

  it('inherits placeholder positions, sizes, colors, and fonts from the layout and master', () => {
    const title = slide1!.blocks[0] as TextBlock;
    expect(title.box).toMatchObject({ x: 838200, y: 365125 });
    expect(title.paragraphs[0]!.runs[0]).toMatchObject({ size: 44, color: '#000000', font: 'Georgia' });
    const body = slide1!.blocks[1] as TextBlock;
    expect(body.paragraphs.map((p) => [p.size, p.marL, p.indent])).toEqual([
      [28, 228600, -228600],
      [24, 685800, -228600],
      [28, 228600, -228600],
    ]);
    // Links take the theme's hyperlink color.
    expect(body.paragraphs[2]!.runs.find((r) => r.href)).toMatchObject({ color: '#0000ff', underline: true });
  });

  it('keeps each picture’s position, and its caption right after it', () => {
    expect(texts(slide4!.blocks)).toEqual([
      'Gallery',
      '[image ppt/media/image1.png]', 'Figure 1: Breadboard',
      '[image ppt/media/image1.png]', 'Figure 2: Scope trace',
      '[image ppt/media/image1.png]', 'Figure 3: Final build',
      'Step 1',
      '[line]',
    ]);
    const pictures = slide4!.blocks.filter((b): b is Extract<Block, { kind: 'image' }> => b.kind === 'image');
    expect(pictures.map((p) => [p.box.x, p.box.y, p.box.w, p.box.h])).toEqual([
      [500000, 1500000, 3000000, 2000000],
      [4500000, 1500000, 3000000, 2000000],
      [8500000, 1500000, 3000000, 2000000],
    ]);
    expect(pictures[1]!.crop).toEqual({ l: 0.1, t: 0, r: 0.1, b: 0 });
    const caption = slide4!.blocks[2] as TextBlock;
    expect(caption.box).toMatchObject({ x: 500000, y: 3600000, w: 3000000, h: 400000 });
    expect(caption.paragraphs[0]).toMatchObject({ align: 'center', size: 14 });
  });

  it('reads shape fills, outlines, and text colors from theme references', () => {
    const step = slide4!.blocks.find((b) => b.kind === 'text' && paragraphsText(b.paragraphs) === 'Step 1') as TextBlock;
    expect(step.style).toMatchObject({ fill: '#c0504d', line: '#602827', geometry: 'roundRect' });
    expect(step.frame.anchor).toBe('middle');
    expect(step.paragraphs[0]!.runs[0]!.color).toBe('#ffffff');
    expect(slide4!.blocks.find((b) => b.kind === 'line')).toMatchObject({ color: '#333333', width: 25400 });
  });

  it('reads backgrounds and the master’s own shapes', () => {
    expect(slide4!.background).toEqual({ color: '#f0f0f0' });
    expect(slide1!.background).toEqual({ color: '#ffffff' });
    expect(slide1!.decor).toHaveLength(1);
    expect(slide1!.decor[0]).toMatchObject({ kind: 'text', paragraphs: [], style: { fill: '#1e5aa8' } });
  });

  it('reads speaker notes without the slide-number placeholder', () => {
    expect(slide1!.notes.map((p) => paragraphsText([p]))).toEqual(['Remember to mention error bars']);
    expect(slide2!.notes).toEqual([]);
  });

  it('reads tables, chart data, and SmartArt text', () => {
    const [, ...rest] = slide2!.blocks;
    const table = rest.find((b) => b.kind === 'table') as Extract<Block, { kind: 'table' }>;
    expect(table.rows.map((r) => r.map((c) => [paragraphsText(c.paragraphs), c.colSpan]))).toEqual([
      [['Trial results', 2]],
      [['Trial 1', 1], ['4.98 V', 1]],
    ]);
    expect(table.colWidths).toEqual([3000000, 3000000]);
    const chart = rest.find((b) => b.kind === 'chart') as Extract<Block, { kind: 'chart' }>;
    expect(chart.chart).toEqual({
      type: 'Column chart',
      title: 'Voltage by trial',
      categoryLabel: 'Category',
      categories: ['Trial 1', 'Trial 2'],
      series: [{ name: 'Volts', values: ['4.98', '5.10'] }],
    });
    const diagram = rest.find((b) => b.kind === 'diagram') as Extract<Block, { kind: 'diagram' }>;
    expect(diagram.items).toEqual([
      { text: 'Design', level: 0 },
      { text: 'Build', level: 0 },
      { text: 'Solder parts', level: 1 },
    ]);
    // Reading order on slide 2: table (top), chart, then SmartArt.
    expect(rest.map((b) => b.kind)).toEqual(['table', 'chart', 'diagram']);
  });

  it('serves only images the browser can show', () => {
    expect(pres.image('ppt/media/image1.png')?.mime).toBe('image/png');
    expect(pres.image('ppt/media/image2.emf')).toBeNull();
  });

  it('rejects files that are not presentations', () => {
    expect(() => readPresentation(new Uint8Array([1, 2, 3]))).toThrow();
  });

  it('is detected by extension', () => {
    expect(detectKind('talk.pptx', makePptx(), false)).toBe('pptx');
    expect(detectKind('deck/show.PPSX', new Uint8Array(), false)).toBe('pptx');
    expect(detectKind('old.ppt', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0]), false)).toBe('binary');
  });
});

describe('autoNumber', () => {
  it.each([
    [3, 'arabicPeriod', '3.'],
    [2, 'arabicParenR', '2)'],
    [1, 'alphaLcParenR', 'a)'],
    [28, 'alphaUcPeriod', 'AB.'],
    [4, 'romanUcPeriod', 'IV.'],
    [9, 'romanLcParenBoth', '(ix)'],
    [5, 'arabicPlain', '5'],
  ])('%s as %s → %s', (n, scheme, expected) => {
    expect(autoNumber(n, scheme)).toBe(expected);
  });
});

describe('renderSlidesView', () => {
  const setup = () => {
    const container = document.createElement('div');
    document.body.append(container);
    const view = renderSlidesView(container, makePptx(), 1, 50 * 1024 * 1024);
    const showMode = (name: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === name)!.click();
    return { container, view, showMode };
  };

  it('shows the disclaimer and lays slides out as they are in PowerPoint', () => {
    const { container, view, showMode } = setup();
    showMode('Slides');
    expect([view.slideCount, view.hiddenCount]).toEqual([4, 1]);
    expect(container.querySelector('.slides-disclaimer')?.textContent).toBe(DISCLAIMER);
    const stages = container.querySelectorAll<HTMLElement>('.slide-stage');
    expect(stages).toHaveLength(4);
    expect([stages[0]!.style.width, stages[0]!.style.height]).toEqual(['1280px', '720px']);
    expect(stages[3]!.style.backgroundColor).toBe('rgb(240, 240, 240)');
    // Pictures and captions sit where they are on the slide.
    const images = stages[3]!.querySelectorAll<HTMLElement>('.sl-image');
    expect([...images].map((i) => [parseFloat(i.style.left), parseFloat(i.style.top)].map(Math.round))).toEqual([[52, 157], [472, 157], [892, 157]]);
    const caption = [...stages[3]!.querySelectorAll<HTMLElement>('.sl-shape')].find((s) => s.textContent === 'Figure 2: Scope trace')!;
    expect([parseFloat(caption.style.left), parseFloat(caption.style.top)].map(Math.round)).toEqual([472, 378]);
    expect(caption.querySelector<HTMLElement>('.sl-para')!.style.textAlign).toBe('center');
    // Cropped picture: the image is scaled up and shifted so the cropped edges are hidden.
    const cropped = images[1]!.querySelector('img')!;
    expect([cropped.style.width, cropped.style.left]).toEqual(['125%', '-12.5%']);
    const step = [...stages[3]!.querySelectorAll<HTMLElement>('.sl-shape')].find((s) => s.textContent === 'Step 1')!;
    expect(step.querySelector<HTMLElement>('.sl-fill')!.style.backgroundColor).toBe('rgb(192, 80, 77)');
    expect(stages[3]!.querySelector('.sl-line line')?.getAttribute('stroke')).toBe('#333333');
    expect(stages[0]!.querySelector('math mfrac')?.textContent).toBe('x2');
    for (const img of container.querySelectorAll('img')) expect(img.getAttribute('src')).toMatch(/^blob:/);
    view.destroy();
    expect(container.children).toHaveLength(0);
  });

  it('has a text outline with cards, notes, links, and chart data', () => {
    const { container, view, showMode } = setup();
    showMode('Text outline');
    const cards = container.querySelectorAll('.slide-card');
    expect(cards).toHaveLength(4);
    expect(container.querySelector('.slide-stage')).toBeNull();
    expect(cards[2]!.classList.contains('hidden-slide')).toBe(true);
    expect(cards[0]!.querySelector('.slide-title')?.textContent).toBe('Lab 3 Results');
    expect(cards[0]!.querySelector('.slide-notes')?.textContent).toContain('Remember to mention error bars');
    const link = cards[0]!.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com/docs');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(cards[0]!.querySelectorAll('a')).toHaveLength(1);
    expect(cards[1]!.querySelector('table.chart-data')?.textContent).toContain('5.10');
    expect(cards[1]!.querySelector('td[colspan="2"]')?.textContent).toBe('Trial results');
    view.setZoom(1.5);
    expect(container.querySelector<HTMLElement>('.slides-list')!.style.getPropertyValue('zoom')).toBe('1.5');
    view.destroy();
  });
});
