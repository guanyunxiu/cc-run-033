import { App } from './app.js';
import './styles.css';

const root = document.getElementById('app');
if (!root) throw new Error('找不到 #app 根节点');

const app = new App();
app.mount(root);
