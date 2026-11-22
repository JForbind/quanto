'use strict';
// Ventana modal (una sola en el DOM).
import { $ } from '../core.js';

export function openModal() { $('#modal').classList.remove('hidden'); }

export function closeModal() { $('#modal').classList.add('hidden'); }
