---
name: design-to-code
description: Rebuild a design (a Figma frame, a screenshot, a sketch) in the app's code as closely as the platform allows, then prove it with side-by-side screenshots and a list of what differs and why. Use when the owner hands over a mock and says "make it like this".
---

# From a design to code

The mock is the target; the app's design system is the material. Where they disagree, say so.

## 1. Read the design

- Figma: get the frame's structure, sizes, colors, text styles and assets (through a Figma tool if one
  is connected; otherwise ask the owner for an export). A screenshot: measure from it, and say which
  values are estimates.
- List what's on it: layout grid, spacing, type styles, colors, radii, shadows, icons, images, and the
  states it shows (and the ones it doesn't — you'll still need them).

## 2. Map to the system

For each value, find the token or component it matches. Where the design's value is off-system (a
13.5 px gap, a near-but-not color), use the token and note the difference; where the design is clearly
deliberate (a new brand color), ask before adding it to the system.

## 3. Build

Structure first (layout and spacing), then type, then color and detail. Real content, not lorem.
Assets exported at the right scales (@2x/@3x, SVG for icons), named the project's way.

## 4. Compare

- Screenshot the result at the design's frame size into `.beluga/scratch/`, and put it next to the
  design (side by side or overlaid at 50%).
- Check: alignment and spacing, type size/weight/line height, colors, radii, icon sizes, truncation.
- Fix differences that aren't intentional; screenshot again.

## 5. Report

The side-by-side images, then a short list: what matches, what differs on purpose (token instead of
off-system value, platform convention) and what you couldn't tell from the design (states, behaviors)
and decided — so the owner can correct it.
