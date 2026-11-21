import './style.css';

interface Round {
  id: string;
  title: string;
  note?: string;
  images: { src: string; caption: string }[];
  critique?: string[];
  fixes?: string[];
}

const base = import.meta.env.BASE_URL;
const el = document.getElementById('proofs')!;
fetch(`${base}proofs/manifest.json`, { cache: 'no-store' })
  .then((r) => r.json())
  .then((m: { intro?: string; rounds: Round[] }) => {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    el.innerHTML =
      (m.intro ? `<p>${esc(m.intro)}</p>` : '') +
      m.rounds
        .slice()
        .reverse()
        .map(
          (r) => `<section><h2>${esc(r.title)}</h2>${r.note ? `<p>${esc(r.note)}</p>` : ''}
${r.images.map((i) => `<figure><a href="${base}${i.src}"><img loading="lazy" src="${base}${i.src}" alt="${esc(i.caption)}"></a><figcaption>${esc(i.caption)}</figcaption></figure>`).join('')}
${r.critique?.length ? `<h3>Critic’s five worst defects (ranked)</h3><ol>${r.critique.map((c) => `<li>${esc(c)}</li>`).join('')}</ol>` : ''}
${r.fixes?.length ? `<h3>Fixed after this review</h3><ul>${r.fixes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}</section>`,
        )
        .join('');
  })
  .catch(() => {
    el.innerHTML = '<p>No proofs yet.</p>';
  });
