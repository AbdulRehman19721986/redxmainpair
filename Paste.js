import axios from 'axios';
import fs from 'fs-extra';
import FormData from 'form-data';

const PASTEBIN_API_URL = 'https://pastebin.com/api/api_post.php';
const API_DEV_KEY = '75TTl3WlG-piY0B40bb_Oh0mxO3nsE7o';

/**
 * Uploads a file to Pastebin and returns the raw URL.
 * @param {string} filePath - Path to the file to upload.
 * @param {string} fileName - Name for the paste (optional).
 * @param {string} fileType - Mime type or extension hint (not used directly).
 * @param {string} privacy - '0' public, '1' unlisted, '2' private.
 * @returns {Promise<string>} Raw Pastebin URL.
 */
export default async function uploadToPastebin(filePath, fileName = 'creds.json', fileType = 'json', privacy = '1') {
    try {
        // Read file content
        const fileContent = await fs.readFile(filePath, 'utf8');

        // Validate JSON (optional)
        try {
            JSON.parse(fileContent);
        } catch (e) {
            throw new Error('Invalid JSON file');
        }

        // Prepare form data
        const formData = new FormData();
        formData.append('api_dev_key', API_DEV_KEY);
        formData.append('api_option', 'paste');
        formData.append('api_paste_code', fileContent);
        formData.append('api_paste_name', fileName);
        formData.append('api_paste_private', privacy);
        formData.append('api_paste_expire_date', '1M'); // 1 month

        // Upload to Pastebin
        const response = await axios.post(PASTEBIN_API_URL, formData, {
            headers: formData.getHeaders(),
        });

        const pasteUrl = response.data.trim();
        if (!pasteUrl.startsWith('https://pastebin.com/')) {
            throw new Error(`Upload failed: ${pasteUrl}`);
        }

        // Convert to raw URL
        const rawUrl = pasteUrl.replace('pastebin.com/', 'pastebin.com/raw/');
        return rawUrl;
    } catch (error) {
        console.error('❌ Pastebin upload error:', error.message);
        throw error;
    }
}
