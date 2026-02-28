import { Storage } from 'megajs';

// Use environment variables for security (fallback to hardcoded only if not set)
const auth = {
    email: process.env.MEGA_EMAIL || 'abdulrehman19721986@gmail.com',
    password: process.env.MEGA_PASSWORD || 'amin1972',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/42.0.2311.135 Safari/537.36 Edge/12.246'
};

export const upload = async (data, name) => {
    if (typeof data === 'string') data = Buffer.from(data);

    const storage = await new Storage({ ...auth }).ready;
    try {
        const file = await storage.upload({ name, size: data.length }, data).complete;
        const url = await file.link();
        return url;
    } catch (err) {
        console.error('MEGA upload error:', err);
        throw err;
    } finally {
        storage.close();
    }
};
