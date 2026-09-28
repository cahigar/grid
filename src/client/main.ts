import './styles.css';
import { LocalBackend } from './backend';
import { App } from './app';

const be = new LocalBackend();
const app = new App(be);
// acceso para depuración desde la consola del navegador
(window as unknown as { grid: unknown }).grid = { app, be };
