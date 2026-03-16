import { describe, it, expect, beforeEach } from 'vitest';
import { findLabelText } from '../../src/utils/ElementMatcher';

describe('findLabelText', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds label via label[for] attribute', () => {
    document.body.innerHTML = `
      <label for="email">Email Address</label>
      <input id="email" type="email">
    `;
    const input = document.getElementById('email')!;
    expect(findLabelText(input)).toBe('Email Address');
  });

  it('finds label via wrapping <label> element', () => {
    document.body.innerHTML = `
      <label>
        Username
        <input id="username" type="text">
      </label>
    `;
    const input = document.getElementById('username')!;
    expect(findLabelText(input)).toBe('Username');
  });

  it('strips input text from wrapping label', () => {
    document.body.innerHTML = `
      <label>
        Name
        <input id="name" type="text" value="John">
      </label>
    `;
    const input = document.getElementById('name')!;
    expect(findLabelText(input)).toBe('Name');
  });

  it('falls back to aria-label', () => {
    document.body.innerHTML = `
      <input id="search" type="text" aria-label="Search box">
    `;
    const input = document.getElementById('search')!;
    expect(findLabelText(input)).toBe('Search box');
  });

  it('falls back to placeholder', () => {
    document.body.innerHTML = `
      <input id="query" type="text" placeholder="Enter search term">
    `;
    const input = document.getElementById('query')!;
    expect(findLabelText(input)).toBe('Enter search term');
  });

  it('falls back to name attribute', () => {
    document.body.innerHTML = `
      <input name="first_name" type="text">
    `;
    const input = document.querySelector('input')!;
    expect(findLabelText(input)).toBe('first_name');
  });

  it('falls back to id attribute', () => {
    document.body.innerHTML = `
      <input id="myField" type="text">
    `;
    const input = document.getElementById('myField')!;
    expect(findLabelText(input)).toBe('myField');
  });

  it('returns empty string for element with no label sources', () => {
    document.body.innerHTML = `<div></div>`;
    const div = document.querySelector('div')!;
    expect(findLabelText(div)).toBe('');
  });

  it('prefers label[for] over wrapping label', () => {
    document.body.innerHTML = `
      <label for="field">Explicit Label</label>
      <label>
        Wrapping Label
        <input id="field" type="text">
      </label>
    `;
    const input = document.getElementById('field')!;
    expect(findLabelText(input)).toBe('Explicit Label');
  });
});
