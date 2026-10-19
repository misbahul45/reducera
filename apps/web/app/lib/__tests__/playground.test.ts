import { describe, expect, it } from 'vitest'
import { PLAYGROUNDS, filterCourses, modeCounts, modeForCourse, playgroundForCourse } from '~/lib/playground'

describe('modeForCourse', () => {
  it.each([
    ['utbk-snbt', 'Persiapan UTBK-SNBT', 'TRYOUT'],
    ['persiapan-snbt', 'Persiapan Seleksi Nasional', 'TRYOUT'],
    ['tryout-matematika', 'Tryout Matematika', 'TRYOUT'],
    ['dasar-basis-data-sql', 'Dasar Basis Data dan SQL', 'SQL'],
    ['sql-lanjutan', 'SQL Lanjutan', 'SQL'],
    ['belajar-postgresql', 'Belajar PostgreSQL', 'SQL'],
    ['mysql-untuk-pemula', 'MySQL untuk Pemula', 'SQL'],
    ['perancangan-database', 'Perancangan Database', 'SQL'],
    ['akuntansi-usaha-dagang', 'Akuntansi Usaha Dagang', 'ACCOUNTING'],
    ['akuntansi-dasar-golden-graph', 'Akuntansi Dasar — Golden Graph', 'ACCOUNTING'],
    ['pembukuan-umkm', 'Pembukuan UMKM', 'ACCOUNTING'],
    ['dasar-python', 'Dasar Python', 'TUTOR'],
    ['bahasa-inggris-bisnis', 'Bahasa Inggris Bisnis', 'TUTOR'],
  ])('maps %s to %s', (slug, title, mode) => {
    expect(modeForCourse({ slug, title })).toBe(mode)
  })

  it('does not read a word that merely contains sql, utbk or akuntansi letters as a match', () => {
    expect(modeForCourse({ slug: 'jurnalistik-dasar', title: 'Dasar Jurnalistik' })).toBe('TUTOR')
    expect(modeForCourse({ slug: 'sqlalchemy-orm', title: 'SQLAlchemy ORM' })).toBe('TUTOR')
  })

  it('prefers the tryout mode when a course mentions both an exam and a topic', () => {
    expect(modeForCourse({ slug: 'utbk-matematika-sql', title: 'UTBK Matematika dan SQL' })).toBe('TRYOUT')
  })
})

describe('playgroundForCourse', () => {
  it('sends a course to its sandbox', () => {
    expect(playgroundForCourse({ slug: 'dasar-basis-data-sql', title: 'Dasar Basis Data dan SQL' })).toMatchObject({ mode: 'SQL', to: '/sandbox/sql' })
    expect(playgroundForCourse({ slug: 'utbk-snbt', title: 'Persiapan UTBK-SNBT' })).toMatchObject({ mode: 'TRYOUT', to: '/sandbox/tryout' })
    expect(playgroundForCourse({ slug: 'akuntansi-usaha-dagang', title: 'Akuntansi Usaha Dagang' })).toMatchObject({ mode: 'ACCOUNTING', to: '/sandbox/akuntansi' })
  })

  it('falls back to practice inside the course when no sandbox fits', () => {
    expect(playgroundForCourse({ slug: 'dasar-python', title: 'Dasar Python' })).toEqual({
      mode: 'TUTOR',
      title: 'Latihan bersama tutor',
      action: 'Latihan di course',
      to: '/my-learning/topics/dasar-python',
    })
  })

  it('encodes a slug that needs it', () => {
    expect(playgroundForCourse({ slug: 'kursus baru', title: 'Kursus Baru' }).to).toBe('/my-learning/topics/kursus%20baru')
  })
})

describe('PLAYGROUNDS', () => {
  it('lists accounting, SQL and tryout with distinct routes and no web-banned vocabulary', () => {
    expect(PLAYGROUNDS.map((playground) => playground.mode)).toEqual(['ACCOUNTING', 'SQL', 'TRYOUT'])
    expect(new Set(PLAYGROUNDS.map((playground) => playground.to)).size).toBe(3)
    const copy = JSON.stringify(PLAYGROUNDS)
    expect(copy).not.toMatch(/SMK|BNSP|SKKNI|sertifikasi|siswa|topik/i)
  })
})

describe('filterCourses and modeCounts', () => {
  const courses = [
    { slug: 'dasar-basis-data-sql', title: 'Dasar Basis Data dan SQL' },
    { slug: 'akuntansi-usaha-dagang', title: 'Akuntansi Usaha Dagang' },
    { slug: 'utbk-snbt', title: 'Persiapan UTBK-SNBT' },
    { slug: 'dasar-python', title: 'Dasar Python' },
    { slug: 'sql-lanjutan', title: 'SQL Lanjutan' },
  ]

  it('filters by the kind of sandbox', () => {
    expect(filterCourses(courses, { mode: 'ALL', q: '' })).toHaveLength(5)
    expect(filterCourses(courses, { mode: 'SQL', q: '' }).map((course) => course.slug)).toEqual(['dasar-basis-data-sql', 'sql-lanjutan'])
    expect(filterCourses(courses, { mode: 'TUTOR', q: '' }).map((course) => course.slug)).toEqual(['dasar-python'])
  })

  it('filters by a title search and combines it with the kind', () => {
    expect(filterCourses(courses, { mode: 'ALL', q: ' dasar ' }).map((course) => course.slug)).toEqual(['dasar-basis-data-sql', 'dasar-python'])
    expect(filterCourses(courses, { mode: 'SQL', q: 'lanjutan' }).map((course) => course.slug)).toEqual(['sql-lanjutan'])
    expect(filterCourses(courses, { mode: 'TRYOUT', q: 'python' })).toEqual([])
  })

  it('counts the courses per kind', () => {
    expect(modeCounts(courses)).toEqual({ ALL: 5, ACCOUNTING: 1, SQL: 2, TRYOUT: 1, TUTOR: 1 })
    expect(modeCounts([])).toEqual({ ALL: 0, ACCOUNTING: 0, SQL: 0, TRYOUT: 0, TUTOR: 0 })
  })
})
