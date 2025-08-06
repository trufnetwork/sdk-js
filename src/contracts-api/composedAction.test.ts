import { describe, test, expect, vi } from 'vitest'
import { ComposedAction } from './composedAction'
import { EthereumAddress } from '../util/EthereumAddress'
import { StreamId } from '../util/StreamId'

describe('ComposedAction Taxonomy Query Methods', () => {
  const createMockClient = (mockResponse: any) => ({
    call: vi.fn().mockResolvedValue({
      status: 200,
      data: {
        result: mockResponse
      }
    })
  });

  const mockSigner = {};

  test('listTaxonomiesByHeight calls correct action with parameters', async () => {
    const mockResponse = [
      {
        data_provider: '0x1234567890abcdef1234567890abcdef12345678',
        stream_id: 'test-stream',
        child_data_provider: '0xabcdef1234567890abcdef1234567890abcdef12',
        child_stream_id: 'child-stream',
        weight: '100.5',
        created_at: 1000,
        group_sequence: 1,
        start_time: 1625097600
      }
    ];

    const mockClient = createMockClient(mockResponse);
    const composedAction = new ComposedAction(mockClient as any, mockSigner as any);

    const result = await composedAction.listTaxonomiesByHeight({
      fromHeight: 1000,
      toHeight: 2000,
      limit: 100,
      offset: 10,
      latestOnly: true
    });

    // Verify the call was made correctly
    expect(mockClient.call).toHaveBeenCalledWith(
      {
        namespace: "main",
        name: 'list_taxonomies_by_height',
        inputs: {
          $from_height: 1000,
          $to_height: 2000,
          $limit: 100,
          $offset: 10,
          $latest_only: true,
        }
      },
      {}
    );

    // Verify response mapping
    expect(result).toHaveLength(1);
    expect(result[0].dataProvider.getAddress()).toBe('0x1234567890abcdef1234567890abcdef12345678');
    expect(result[0].streamId.getId()).toBe('test-stream');
    expect(result[0].childDataProvider.getAddress()).toBe('0xabcdef1234567890abcdef1234567890abcdef12');
    expect(result[0].childStreamId.getId()).toBe('child-stream');
    expect(result[0].weight).toBe('100.5');
    expect(result[0].createdAt).toBe(1000);
    expect(result[0].groupSequence).toBe(1);
    expect(result[0].startTime).toBe(1625097600);
  });

  test('listTaxonomiesByHeight handles default parameters', async () => {
    const mockClient = createMockClient([]);
    const composedAction = new ComposedAction(mockClient as any, mockSigner as any);

    await composedAction.listTaxonomiesByHeight({});

    expect(mockClient.call).toHaveBeenCalledWith(
      {
        namespace: "main",
        name: 'list_taxonomies_by_height',
        inputs: {
          $from_height: null,
          $to_height: null,
          $limit: null,
          $offset: null,
          $latest_only: null,
        }
      },
      {}
    );
  });

  test('listTaxonomiesByHeight handles empty parameters', async () => {
    const mockClient = createMockClient([]);
    const composedAction = new ComposedAction(mockClient as any, mockSigner as any);

    await composedAction.listTaxonomiesByHeight();

    expect(mockClient.call).toHaveBeenCalledWith(
      {
        namespace: "main",
        name: 'list_taxonomies_by_height',
        inputs: {
          $from_height: null,
          $to_height: null,
          $limit: null,
          $offset: null,
          $latest_only: null,
        }
      },
      {}
    );
  });

  test('getTaxonomiesForStreams calls correct action with stream arrays', async () => {
    const mockResponse = [
      {
        data_provider: '0x1111111111111111111111111111111111111111',
        stream_id: 'stream-1',
        child_data_provider: '0x2222222222222222222222222222222222222222',
        child_stream_id: 'child-1',
        weight: '50.0',
        created_at: 2000,
        group_sequence: 2,
        start_time: 1625097700
      }
    ];

    const mockClient = createMockClient(mockResponse);
    const composedAction = new ComposedAction(mockClient as any, mockSigner as any);

    const testStreams = [
      {
        dataProvider: EthereumAddress.fromString('0x1111111111111111111111111111111111111111').throw(),
        streamId: StreamId.fromString('stream-1').throw()
      },
      {
        dataProvider: EthereumAddress.fromString('0x3333333333333333333333333333333333333333').throw(),
        streamId: StreamId.fromString('stream-2').throw()
      }
    ];

    const result = await composedAction.getTaxonomiesForStreams({
      streams: testStreams,
      latestOnly: false
    });

    // Verify the call was made correctly
    expect(mockClient.call).toHaveBeenCalledWith(
      {
        namespace: "main",
        name: 'get_taxonomies_for_streams',
        inputs: {
          $data_providers: [
            '0x1111111111111111111111111111111111111111',
            '0x3333333333333333333333333333333333333333'
          ],
          $stream_ids: ['stream-1', 'stream-2'],
          $latest_only: false,
        }
      },
      {}
    );

    // Verify response mapping
    expect(result).toHaveLength(1);
    expect(result[0].dataProvider.getAddress()).toBe('0x1111111111111111111111111111111111111111');
    expect(result[0].streamId.getId()).toBe('stream-1');
    expect(result[0].weight).toBe('50.0');
  });

  test('getTaxonomiesForStreams handles empty stream array', async () => {
    const mockClient = createMockClient([]);
    const composedAction = new ComposedAction(mockClient as any, mockSigner as any);

    const result = await composedAction.getTaxonomiesForStreams({
      streams: [],
      latestOnly: true
    });

    // Should return empty array without making network call
    expect(mockClient.call).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  test('getTaxonomiesForStreams handles latestOnly parameter', async () => {
    const mockClient = createMockClient([]);
    const composedAction = new ComposedAction(mockClient as any, mockSigner as any);

    const testStreams = [
      {
        dataProvider: EthereumAddress.fromString('0x1111111111111111111111111111111111111111').throw(),
        streamId: StreamId.fromString('stream-1').throw()
      }
    ];

    await composedAction.getTaxonomiesForStreams({
      streams: testStreams,
      latestOnly: true
    });

    expect(mockClient.call).toHaveBeenCalledWith(
      {
        namespace: "main",
        name: 'get_taxonomies_for_streams',
        inputs: expect.objectContaining({
          $latest_only: true,
        })
      },
      {}
    );
  });

  test('getTaxonomiesForStreams handles default latestOnly parameter', async () => {
    const mockClient = createMockClient([]);
    const composedAction = new ComposedAction(mockClient as any, mockSigner as any);

    const testStreams = [
      {
        dataProvider: EthereumAddress.fromString('0x1111111111111111111111111111111111111111').throw(),
        streamId: StreamId.fromString('stream-1').throw()
      }
    ];

    await composedAction.getTaxonomiesForStreams({
      streams: testStreams
    });

    expect(mockClient.call).toHaveBeenCalledWith(
      {
        namespace: "main",
        name: 'get_taxonomies_for_streams',
        inputs: expect.objectContaining({
          $latest_only: null,
        })
      },
      {}
    );
  });

  test('listTaxonomiesByHeight handles network error', async () => {
    const mockClient = {
      call: vi.fn().mockResolvedValue({
        status: 500,
        data: null
      })
    };

    const composedAction = new ComposedAction(mockClient as any, mockSigner as any);

    await expect(
      composedAction.listTaxonomiesByHeight({
        fromHeight: 1000,
        toHeight: 2000
      })
    ).rejects.toThrow();
  });

  test('getTaxonomiesForStreams handles network error', async () => {
    const mockClient = {
      call: vi.fn().mockResolvedValue({
        status: 404,
        data: null
      })
    };

    const composedAction = new ComposedAction(mockClient as any, mockSigner as any);

    const testStreams = [
      {
        dataProvider: EthereumAddress.fromString('0x1111111111111111111111111111111111111111').throw(),
        streamId: StreamId.fromString('stream-1').throw()
      }
    ];

    await expect(
      composedAction.getTaxonomiesForStreams({
        streams: testStreams
      })
    ).rejects.toThrow();
  });

  test('methods handle multiple results correctly', async () => {
    const mockResponse = [
      {
        data_provider: '0x1111111111111111111111111111111111111111',
        stream_id: 'stream-1',
        child_data_provider: '0x2222222222222222222222222222222222222222',
        child_stream_id: 'child-1',
        weight: '50.0',
        created_at: 2000,
        group_sequence: 1,
        start_time: 1625097600
      },
      {
        data_provider: '0x1111111111111111111111111111111111111111',
        stream_id: 'stream-1',
        child_data_provider: '0x3333333333333333333333333333333333333333',
        child_stream_id: 'child-2',
        weight: '25.5',
        created_at: 2000,
        group_sequence: 1,
        start_time: 1625097600
      }
    ];

    const mockClient = createMockClient(mockResponse);
    const composedAction = new ComposedAction(mockClient as any, mockSigner as any);

    const result = await composedAction.listTaxonomiesByHeight({ limit: 10 });

    expect(result).toHaveLength(2);
    expect(result[0].childStreamId.getId()).toBe('child-1');
    expect(result[1].childStreamId.getId()).toBe('child-2');
    expect(result[0].weight).toBe('50.0');
    expect(result[1].weight).toBe('25.5');
  });

  test('methods handle address parsing correctly', async () => {
    const mockResponse = [
      {
        data_provider: '0x1234567890abcdef1234567890abcdef12345678',
        stream_id: 'test-stream',
        child_data_provider: '0xabcdef1234567890abcdef1234567890abcdef12',
        child_stream_id: 'child-stream',
        weight: '100.0',
        created_at: 1000,
        group_sequence: 1,
        start_time: 1625097600
      }
    ];

    const mockClient = createMockClient(mockResponse);
    const composedAction = new ComposedAction(mockClient as any, mockSigner as any);

    const result = await composedAction.listTaxonomiesByHeight();

    expect(result[0].dataProvider).toBeInstanceOf(EthereumAddress);
    expect(result[0].streamId).toBeInstanceOf(StreamId);
    expect(result[0].childDataProvider).toBeInstanceOf(EthereumAddress);
    expect(result[0].childStreamId).toBeInstanceOf(StreamId);
    
    expect(result[0].dataProvider.getAddress()).toBe('0x1234567890abcdef1234567890abcdef12345678');
    expect(result[0].streamId.getId()).toBe('test-stream');
    expect(result[0].childDataProvider.getAddress()).toBe('0xabcdef1234567890abcdef1234567890abcdef12');
    expect(result[0].childStreamId.getId()).toBe('child-stream');
  });
});