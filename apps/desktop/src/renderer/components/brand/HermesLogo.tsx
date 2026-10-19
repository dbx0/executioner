import type { JSX } from 'react'
/**
 * The Hermes mark — Nous Research's official Hermes agent icon (their 64x64
 * brand glyph), embedded as a self-contained data URI so it needs no external
 * asset or network. Nominative use: the mark identifies a Hermes agent session.
 * `className` controls sizing (e.g. `size-4`); the image is rounded to match the
 * other brand glyphs.
 */
const HERMES_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAPFBMVEVzc3Pn5+ccHBszMzMBAQH///8AAAAYGBgLCwscHBxLS0vGxsbX19dfX19+fn7z8/OgoKCysrKGhoaSkpIgp1CAAAAACnRSTlP9////ff//gICA//OAVQAABGdJREFUWIWll4uWnCAMQANUuiXh/f//2gRQAZ1te8rZs6MOXPNOBn7Af60f8Cse/7HUF/xUn76MmIJ3zodM/w6IRDml4uxYgO+CfgBQShnba1U6ESa9IV4BebxXB/lK+QuBfwXI2t6rypOy3n4PIGeX5eTbcN36PwGS3ZcWzS8tLHwLiP5xnDVnQtTnrU7fAJTZT2vtq5eX5v5Ae4v4EaBMe89N8c5mMaoccSKMNiGpED8BjNO6ndKDYUhsZsHwf7SWTVlEm/QBUCoTjE38KvBOGOnIKpJxSkKqpphTjCyQia8AQiJvTMrVGeRHThIgskLGuiL+0Zg0uMTo/ArI/KFqbW+jopTsihGaI8SVirXjS8cAH18AlChGRVB9CRokgkz1tQ5rdDNa/muGohcAeO0L6OGD0+1mXJRDEQe0k7BgQHkBaDf5z27xbD00J8hzPWJrA9Dlu+7AjaCT9m6A9VBpBdRL7H4grAC2CHuAwabvCw8AbAeSXm61JAmf1q4D3ANwZdE4CHUFdN3ZGONefQaMK1pFuFXpn/hZhVFHfbeCeRCGii9GPBd5KLaqI0EpIe+EISDsADo3tNJbsTifh7NXXYYO5hFIvlmqUE+U3EpRV3TIMOLktJHaAapJB1jbKRLRi4V4AQIi+UkH3AFcj0wSo41UKxyvQJMEdrjYd5XqA8AZn9Em0+I8YoYS6MUGLRjtHUprVVY2lO4gzmw1jLg7cujwCkBrpkztK34A0Bsg28f528GbI9MbILFt9hacd8AQwb8BqlUYt2Hi6qx6Beg3ANgY9xa+F6crHegF4Cwbf7Ph5sVWFScjrAAu+Rj6ZHLaYrehVIYugnsC+G2eG5yBSQ1c9Ze6IlkhUsQHgPPBqoQHTmr0PL8tKScF4Ec6LAARN6h1lmqVxuAsQasyeVTWBdC2TePG5YSibgmGQqh7TRiAPgS2+WadYboT6JpQWmltgNCN0AHU63yY/HsCesyco9M16VjM3QgdUHoKzO6Z7Gr9FUy3N5D1TQoHwIdrs+wnTuZcId9hkGEHEErL9QPgzGWCeeUB4CKVt/M2ZjFXyQ3A013oe/UauNRtQE+4kSrsj+SjABScRbfs25pnHW7P+eVChqOaLkEYhbOWtUlbsO8dzqIYJRyg1c9mg96Asmixpi88ClJbukV4OkyXgDVE5BxoVlgaPSxNbwK0/+wJPyLRW5e6q+rcDOvh1TuhUThw8gBcU/aUNrbyZJm5bOCjRfeV2JPxSibsfSvOJohovKYRDM61YdmFU0dNYoUpG8lRXGcldhN3Kw4iFwqbHZCUwlJ6j7TJSWWe09k6EGEnKyJVUSCTwrudkpFMlARxcQV09dMUNO5g/7KYMgVODVAn1038KGkVCh2zybR1dCiltJ2LteKR3obR1B+/2u5O5NhLKJ360GuRYLXc2QMfgLsPmNrV9px4e7cBNw0Y64/v4UbIPKy2ccenAx4tV10/hBnwBeFe47zj4V3rwg+8haJ92Fc5L+DrN9ijZSiX90rqAAAAAElFTkSuQmCC'

export function HermesLogo({ className }: { className?: string }): JSX.Element {
  return (
    <img
      src={HERMES_ICON}
      alt=""
      aria-hidden="true"
      draggable={false}
      // Unlike the SVG marks (which the dropdown/row styles size), an <img> has
      // its natural 64px size unless constrained — default to size-4 so it never
      // renders huge where a caller passes no className (e.g. the spawn menu).
      className={className ?? 'size-4 shrink-0'}
      style={{ borderRadius: '4px', objectFit: 'contain' }}
    />
  )
}
