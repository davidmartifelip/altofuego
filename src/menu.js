/**
 * Altofuego Menu — CSV Parser & Renderer
 * Owner edits public/menu.csv to update the menu. No code needed.
 */

// ─── CSV Parser ───
function parseCSV(text) {
    const lines = text.trim().split('\n')
    const headers = lines[0].split(',').map(h => h.trim())

    return lines.slice(1).map(line => {
        // Handle quoted fields with commas inside
        const values = []
        let current = ''
        let inQuotes = false
        for (const ch of line) {
            if (ch === '"') { inQuotes = !inQuotes; continue }
            if (ch === ',' && !inQuotes) { values.push(current.trim()); current = ''; continue }
            current += ch
        }
        values.push(current.trim())

        return headers.reduce((obj, header, i) => {
            obj[header] = values[i] ?? ''
            return obj
        }, {})
    }).filter(row => row.disponible === 'true' && row.nombre)
}

// ─── Group by category ───
function groupByCategory(dishes) {
    const groups = {}
    for (const dish of dishes) {
        if (!groups[dish.categoria]) {
            groups[dish.categoria] = {
                orden: parseInt(dish.orden_categoria),
                dishes: []
            }
        }
        groups[dish.categoria].dishes.push(dish)
    }
    return Object.entries(groups).sort((a, b) => a[1].orden - b[1].orden)
}

// ─── Tag labels ───
const TAG_CONFIG = {
    signature: { label: 'Signature', color: '#E8590C' },
    sin_gluten: { label: 'Sin gluten', color: '#16a34a' },
    vegetariano: { label: 'Vegetariano', color: '#65a30d' },
    temporada: { label: 'Temporada', color: '#d97706' },
    mar: { label: 'Del Mar', color: '#0891b2' },
}

function renderTags(tagsStr) {
    if (!tagsStr.trim()) return ''
    return tagsStr.trim().split(' ')
        .map(tag => {
            const cfg = TAG_CONFIG[tag]
            if (!cfg) return ''
            return `<span class="dish-tag" style="background:${cfg.color}20;color:${cfg.color};border-color:${cfg.color}30">${cfg.label}</span>`
        })
        .join('')
}

// ─── Render a single dish card ───
function renderDish(dish) {
    const price = parseFloat(dish.precio)
    const isSignature = dish.etiquetas.includes('signature')

    return `
    <article class="dish-card ${isSignature ? 'dish-signature' : ''}" role="listitem">
      <div class="dish-header">
        <div class="dish-info">
          <h3 class="dish-name">${dish.nombre}</h3>
          ${dish.descripcion ? `<p class="dish-desc">${dish.descripcion}</p>` : ''}
          <div class="dish-tags">${renderTags(dish.etiquetas)}</div>
        </div>
        <div class="dish-price">
          ${isNaN(price) ? dish.precio : `${price.toFixed(0)} €`}
        </div>
      </div>
    </article>
  `
}

// ─── Render a category section ───
function renderCategory(name, { dishes }) {
    return `
    <section class="menu-section" aria-labelledby="cat-${name.replace(/\s/g, '-')}">
      <header class="category-header">
        <h2 class="category-title" id="cat-${name.replace(/\s/g, '-')}">${name}</h2>
        <div class="category-line" aria-hidden="true"></div>
      </header>
      <div class="dishes-grid" role="list">
        ${dishes.map(renderDish).join('')}
      </div>
    </section>
  `
}

// ─── Main: fetch CSV and render ───
async function loadMenu() {
    const container = document.getElementById('menu-container')
    const loading = document.getElementById('menu-loading')

    try {
        const res = await fetch('/menu.csv')
        if (!res.ok) throw new Error(`Error ${res.status} cargando el menú`)
        const text = await res.text()

        const dishes = parseCSV(text)
        const grouped = groupByCategory(dishes)

        loading.style.display = 'none'
        container.innerHTML = grouped.map(([name, data]) => renderCategory(name, data)).join('')

        // Intersection Observer for scroll animations
        const cards = document.querySelectorAll('.dish-card, .menu-section')
        const observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible')
                    observer.unobserve(entry.target)
                }
            })
        }, { threshold: 0.05, rootMargin: '0px 0px -40px 0px' })

        cards.forEach(card => observer.observe(card))

    } catch (err) {
        loading.innerHTML = `
      <p style="color:#E8590C;font-family:var(--font-sans)">
        Error cargando el menú: ${err.message}
      </p>
    `
        console.error('[Menu]', err)
    }
}

loadMenu()

// ─── Category nav active state on scroll ───
window.addEventListener('scroll', () => {
    const sections = document.querySelectorAll('.menu-section')
    const navLinks = document.querySelectorAll('.cat-nav-link')
    let current = ''

    sections.forEach(section => {
        const top = section.getBoundingClientRect().top
        if (top < 160) current = section.querySelector('h2')?.id ?? ''
    })

    navLinks.forEach(link => {
        link.classList.toggle('active', link.getAttribute('href') === `#${current}`)
    })
}, { passive: true })
