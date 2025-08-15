import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { PeerDB } from '../../src/core/peering/peerDB';
import { logger } from '../../src/core/logger';
import axios from 'axios';

// Mock axios to test tracker functionality without real network calls
vi.mock('axios');
const mockedAxios = vi.mocked(axios);

describe('PeerDB Tracker Announcements', () => {
    let peerDB: PeerDB;

    beforeEach(() => {
        peerDB = new PeerDB({ ourPort: 1984 });
        vi.clearAllMocks();
    });

    afterEach(() => {
        peerDB.shutdown();
    });

    it('should use updated tracker URLs', async () => {
        // Mock successful tracker response with empty peer list
        const mockResponse = {
            data: Buffer.from('d8:intervali1800e5:peers0:e', 'ascii') // Empty peers bencode response
        };
        mockedAxios.get.mockResolvedValue(mockResponse);

        await peerDB.announce();

        // Verify that the new tracker URLs are being used
        expect(mockedAxios.get).toHaveBeenCalledTimes(11); // Should have 11 new trackers

        const calledUrls = mockedAxios.get.mock.calls.map(call => call[0].split('?')[0]);
        
        // Verify new trackers are in the list
        expect(calledUrls).toContain('https://tracker.opentrackr.org:443/announce');
        expect(calledUrls).toContain('http://bt1.archive.org:6969/announce');
        expect(calledUrls).toContain('http://bt2.archive.org:6969/announce');
        expect(calledUrls).toContain('https://tracker.tamersunion.org:443/announce');
    });

    it('should handle tracker timeout gracefully', async () => {
        // Mock timeout error
        mockedAxios.get.mockRejectedValue(new Error('timeout of 5000ms exceeded'));

        await peerDB.announce();

        // Should log the error and continue
        expect(mockedAxios.get).toHaveBeenCalled();
        // No peers should be learned from failed requests
        expect(peerDB.peersUnverified.size).toBe(0);
    });

    it('should handle mixed success/failure responses', async () => {
        // Mock some trackers succeeding and others failing
        mockedAxios.get
            .mockResolvedValueOnce({ data: Buffer.from('d8:intervali1800e5:peers6:\x7f\x00\x00\x01\x1f\x90e', 'ascii') }) // Success with 1 peer
            .mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND'))  // DNS failure
            .mockResolvedValueOnce({ data: Buffer.from('d8:intervali1800e5:peers0:e', 'ascii') }) // Success with 0 peers
            .mockRejectedValue(new Error('timeout')); // Rest fail

        await peerDB.announce();

        // Should have learned 1 peer from successful responses
        expect(peerDB.peersUnverified.size).toBe(1);
    });

    it('should use proper request parameters', async () => {
        const mockResponse = {
            data: Buffer.from('d8:intervali1800e5:peers0:e', 'ascii')
        };
        mockedAxios.get.mockResolvedValue(mockResponse);

        await peerDB.announce();

        // Check that at least one request was made with correct parameters
        const firstCall = mockedAxios.get.mock.calls[0];
        expect(firstCall[0]).toContain('info_hash=Ministry+of+Truth%00%00%00');
        expect(firstCall[0]).toContain('port=1984');

        // Check axios configuration
        const axiosConfig = firstCall[1];
        expect(axiosConfig.timeout).toBe(5000);
        expect(axiosConfig.responseType).toBe('arraybuffer');
        expect(axiosConfig.headers['User-Agent']).toBe('Verity/0.1.0');
    });

    it('should work with test trackers override', async () => {
        const testTrackers = ['http://test-tracker.example.com/announce'];
        const mockResponse = {
            data: Buffer.from('d8:intervali1800e5:peers0:e', 'ascii')
        };
        mockedAxios.get.mockResolvedValue(mockResponse);

        await peerDB.announce(testTrackers);

        expect(mockedAxios.get).toHaveBeenCalledTimes(1);
        expect(mockedAxios.get.mock.calls[0][0]).toContain('test-tracker.example.com');
    });
});
