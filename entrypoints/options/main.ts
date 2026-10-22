import { normalizeDomain, originPattern } from '@/src/settings/domains';
import { parseLanguageOverrides, formatLanguageOverrides } from '@/src/settings/overrides';
import type { Settings } from '@/src/settings/schema';
import {
  deleteAllAssignmentLayouts,
  deleteAssignmentLayout,
  listAllLayouts,
  onLayoutsChanged,
  parseAssignmentKey,
  type AssignmentLayouts,
} from '@/src/settings/savedLayouts';
import { loadSettings, saveSettings } from '@/src/settings/storage';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let settings: Settings;

async function renderDomains() {
  const list = $<HTMLUListElement>('domain-list');
  list.replaceChildren();
  for (const domain of settings.domains) {
    const granted = await browser.permissions.contains({ origins: [originPattern(domain)] });
    const li = document.createElement('li');

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = domain;

    const status = document.createElement('span');
    status.className = granted ? 'status-ok' : 'status-missing';
    status.textContent = granted ? 'Active' : 'Access not granted';
    li.append(name, status);

    if (!granted) {
      const grant = document.createElement('button');
      grant.textContent = 'Grant access';
      // permissions.request must be the first call in the click handler (Firefox requires
      // it to run synchronously inside the user gesture).
      grant.addEventListener('click', () => {
        void browser.permissions.request({ origins: [originPattern(domain)] }).then(renderDomains);
      });
      li.append(grant);
    }

    const remove = document.createElement('button');
    remove.className = 'secondary';
    remove.textContent = 'Remove';
    remove.addEventListener('click', async () => {
      settings.domains = settings.domains.filter((d) => d !== domain);
      await saveSettings({ domains: settings.domains });
      await browser.permissions.remove({ origins: [originPattern(domain)] }).catch(() => {});
      await renderDomains();
    });
    li.append(remove);
    list.append(li);
  }
  $('setup-banner').hidden = settings.domains.some((d) => d !== '*.instructure.com');
}

function setupDomainForm() {
  const input = $<HTMLInputElement>('domain-input');
  const error = $('domain-error');
  $('domain-form').addEventListener('submit', (event) => {
    event.preventDefault();
    error.hidden = true;
    const domain = normalizeDomain(input.value);
    if (!domain) {
      error.textContent = 'Enter a Canvas address like canvas.yourschool.edu (https only).';
      error.hidden = false;
      return;
    }
    // Request first, synchronously within the submit gesture; persist afterwards.
    void browser.permissions.request({ origins: [originPattern(domain)] }).then(async (granted) => {
      if (!granted) {
        error.textContent = `Access to ${domain} was not granted, so SpeedView can't run there.`;
        error.hidden = false;
      }
      if (!settings.domains.includes(domain)) {
        settings.domains = [...settings.domains, domain];
        await saveSettings({ domains: settings.domains });
      }
      input.value = '';
      await renderDomains();
    });
  });
}

function setupSimpleSettings() {
  for (const el of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]')) {
    const key = el.dataset.setting as keyof Settings;
    const value = settings[key];
    if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = value as boolean;
    else el.value = String(value);

    el.addEventListener('change', () => {
      let next: unknown;
      if (el instanceof HTMLInputElement && el.type === 'checkbox') next = el.checked;
      else if (el instanceof HTMLInputElement && el.type === 'number') {
        const n = Number(el.value);
        if (!Number.isFinite(n) || el.value === '') {
          el.value = String(settings[key]);
          return;
        }
        next = Math.min(Math.max(n, Number(el.min)), Number(el.max));
        el.value = String(next);
      } else next = el.value;
      (settings as unknown as Record<string, unknown>)[key] = next;
      void saveSettings({ [key]: next });
    });
  }
}

function setupOverrides() {
  const textarea = $<HTMLTextAreaElement>('languageOverrides');
  const error = $('overrides-error');
  textarea.value = formatLanguageOverrides(settings.languageOverrides);
  textarea.addEventListener('change', () => {
    const { overrides, invalidLines } = parseLanguageOverrides(textarea.value);
    error.hidden = invalidLines.length === 0;
    error.textContent = invalidLines.length ? `Couldn't read line(s): ${invalidLines.join(', ')}` : '';
    settings.languageOverrides = overrides;
    void saveSettings({ languageOverrides: overrides });
  });
}

/** A button that asks for a second click before running `action`. */
function confirmButton(label: string, confirmLabel: string, action: () => Promise<void>): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary';
  button.textContent = label;
  button.addEventListener('click', () => {
    if (button.dataset.armed) {
      void action();
      return;
    }
    button.dataset.armed = '1';
    button.className = 'danger';
    button.textContent = confirmLabel;
  });
  button.addEventListener('blur', () => {
    delete button.dataset.armed;
    button.className = 'secondary';
    button.textContent = label;
  });
  return button;
}

function assignmentHeading(record: AssignmentLayouts): { title: string; subtitle: string; url: string | null } {
  const { origin, courseId, assignmentId } = parseAssignmentKey(record.key);
  const host = (() => {
    try {
      return new URL(origin).host;
    } catch {
      return origin;
    }
  })();
  const url = /^https:\/\//.test(origin) ? `${origin}/courses/${encodeURIComponent(courseId)}/gradebook/speed_grader?assignment_id=${encodeURIComponent(assignmentId)}` : null;
  return {
    title: record.assignment ?? `Assignment ${assignmentId}`,
    subtitle: [record.course ?? `Course ${courseId}`, host].join(' · '),
    url,
  };
}

async function renderLayouts() {
  const container = $('layouts');
  const records = (await listAllLayouts()).map((record) => ({ record, heading: assignmentHeading(record) }));
  records.sort((a, b) => a.heading.subtitle.localeCompare(b.heading.subtitle) || a.heading.title.localeCompare(b.heading.title));
  if (!records.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No saved layouts yet. Use “Save as my layout…” in the waveform viewer to add one.';
    container.replaceChildren(empty);
    return;
  }
  container.replaceChildren(
    ...records.map(({ record, heading }) => {
      const card = document.createElement('div');
      card.className = 'layout-card';
      const head = document.createElement('div');
      head.className = 'layout-head';
      const titles = document.createElement('div');
      titles.className = 'layout-titles';
      const title = document.createElement(heading.url ? 'a' : 'strong');
      title.textContent = heading.title;
      if (heading.url && title instanceof HTMLAnchorElement) {
        title.href = heading.url;
        title.target = '_blank';
        title.rel = 'noopener noreferrer';
        title.title = 'Open this assignment in SpeedGrader';
      }
      const subtitle = document.createElement('span');
      subtitle.className = 'muted';
      subtitle.textContent = heading.subtitle;
      titles.append(title, subtitle);
      head.append(
        titles,
        confirmButton(
          record.layouts.length > 1 ? `Delete all ${record.layouts.length}` : 'Delete',
          'Click again to delete',
          () => deleteAllAssignmentLayouts(record.key),
        ),
      );
      card.append(head);
      if (record.layouts.length > 1) {
        const list = document.createElement('ul');
        list.className = 'layout-list';
        for (const layout of record.layouts) {
          const li = document.createElement('li');
          const name = document.createElement('span');
          name.className = 'name';
          name.textContent = layout.name;
          li.append(name);
          if (layout.savedAt) {
            const date = document.createElement('span');
            date.className = 'muted';
            date.textContent = new Date(layout.savedAt).toLocaleDateString();
            li.append(date);
          }
          li.append(confirmButton('Delete', 'Click again', () => deleteAssignmentLayout(record.key, layout.id)));
          list.append(li);
        }
        card.append(list);
      } else {
        const only = document.createElement('p');
        only.className = 'layout-single';
        only.textContent = record.layouts[0]!.name;
        card.append(only);
      }
      return card;
    }),
  );
}

async function init() {
  settings = await loadSettings();
  setupDomainForm();
  setupSimpleSettings();
  setupOverrides();
  await renderDomains();
  await renderLayouts();
  onLayoutsChanged(() => void renderLayouts());
  browser.permissions.onAdded.addListener(() => void renderDomains());
  browser.permissions.onRemoved.addListener(() => void renderDomains());
}

void init();
