/**
 * Paste.js – Upload creds.json to Pastebin, return raw URL.
 *
 * Env vars:
 *   PASTEBIN_API_KEY  – your Pastebin API dev key  (required for user-linked pastes)
 *   PASTEBIN_PRIVACY  – 0=public, 1=unlisted (default), 2=private
 *   PASTEBIN_EXPIRE   – expiry: N (never), 10M, 1H, 1D, 1W, 2W, 1M (default 1M)
 */

import axios from 'axios';
import fs from 'fs-extra';
import FormData from 'form-data';

const PASTEBIN_API_URL = 'https://pastebin.com/api/api_post.php';
const API_DEV_KEY      = process.env.PASTEBIN_API_KEY || '75TTl3WlG-piY0B40bb_Oh0mxO3nsE7o';
const PRIVACY          = process.env.PASTEBIN_PRIVACY || '1';
const EXPIRE           = process.env.PASTEBIN_EXPIRE  || '1M';

/**
 * Upload a file path to Pastebin.
 * @param {string} filePath   - Local path to creds.json
 * @param {string} [pasteName] - Paste title
 * @returns {Promise<string>}  - Raw Pastebin URL: https://pastebin.com/raw/XXXXXXXX
 */
export async function uploadFile(filePath, pasteName = 'creds.json') {
    const content = await fs.readFile(filePath, 'utf8');
    // Validate JSON before upload
    JSON.parse(content);
    return uploadContent(content, pasteName);
}

/**
 * Upload raw string content to Pastebin.
 * @param {string} content
 * @param {string} [pasteName]
 * @returns {Promise<string>}  - Raw Pastebin URL
 */
export async function uploadContent(content, pasteName = 'session') {
    const form = new FormData();
    form.append('api_dev_key',          API_DEV_KEY);
    form.append('api_option',           'paste');
    form.append('api_paste_code',       content);
    form.append('api_paste_name',       pasteName);
    form.append('api_paste_private',    PRIVACY);
    form.append('api_paste_expire_date', EXPIRE);
    form.append('api_paste_format',     'json');

    const response = await axios.post(PASTEBIN_API_URL, form, {
        headers: form.getHeaders(),
        timeout: 15_000,
    });

    const url = response.data.trim();
    if (!url.startsWith('https://pastebin.com/')) {
        throw new Error(`Pastebin error: ${url}`);
    }

    // Convert normal URL → raw URL
    return url.replace('pastebin.com/', 'pastebin.com/raw/');
}

// Default export for backward compatibility
export default uploadFile;
