"""从生成的产品照片推导「法线 + 粗糙度」贴图（纯标准库，无 Pillow / numpy）。
思路：只用照片的**高频细节**，去掉低频光照梯度，所以颜色完全不受影响。
"""
import base64
import struct
import sys
import zlib


def read_png(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    pos, idat = 8, b''
    w = h = bd = ct = None
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + ln]
        if typ == b'IHDR':
            w, h, bd, ct, _c, _f, inter = struct.unpack('>IIBBBBB', body)
            assert bd == 8 and inter == 0, 'only 8-bit non-interlaced'
        elif typ == b'IDAT':
            idat += body
        pos += 12 + ln
    ch = {0: 1, 2: 3, 4: 2, 6: 4}[ct]
    raw = zlib.decompress(idat)
    stride = w * ch
    out = bytearray(h * stride)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        ft = raw[p]; p += 1
        line = bytearray(raw[p:p + stride]); p += stride
        if ft == 1:
            for i in range(ch, stride):
                line[i] = (line[i] + line[i - ch]) & 255
        elif ft == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif ft == 3:
            for i in range(stride):
                a = line[i - ch] if i >= ch else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif ft == 4:
            for i in range(stride):
                a = line[i - ch] if i >= ch else 0
                b = prev[i]
                c = prev[i - ch] if i >= ch else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, ch, out


def write_png(path, w, h, ch, buf):
    ct = {1: 0, 3: 2}[ch]
    raw = bytearray()
    stride = w * ch
    for y in range(h):
        raw.append(0)
        raw += buf[y * stride:(y + 1) * stride]

    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)

    ihdr = struct.pack('>IIBBBBB', w, h, 8, ct, 0, 0, 0)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + \
          chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(png)
    return len(png)


def main(src, out_prefix, crop_x, crop_y, crop_s, out_s):
    w, h, ch, buf = read_png(src)
    print('源图 %dx%d ch=%d' % (w, h, ch))
    # 1) 裁剪 + 2x2 平均降采样（crop_s -> out_s，取整数倍）
    step = crop_s / out_s
    assert step == int(step), 'crop_s 必须是 out_s 的整数倍'
    step = int(step)
    lum = [0.0] * (out_s * out_s)
    for y in range(out_s):
        for x in range(out_s):
            acc = 0.0
            for dy in range(step):
                row = (crop_y + y * step + dy) * w
                for dx in range(step):
                    i = (row + crop_x + x * step + dx) * ch
                    acc += 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2]
            lum[y * out_s + x] = acc / (step * step)

    # 2) 去低频：减去大半径均值（只留表面细节）
    S = out_s
    R = 24
    tmp = [0.0] * (S * S)
    for y in range(S):
        acc = 0.0
        for x in range(-R, R + 1):
            acc += lum[y * S + min(S - 1, max(0, x))]
        for x in range(S):
            tmp[y * S + x] = acc / (2 * R + 1)
            add = lum[y * S + min(S - 1, x + R + 1)]
            sub = lum[y * S + max(0, x - R)]
            acc += add - sub
    det = [0.0] * (S * S)
    for x in range(S):
        acc = 0.0
        for y in range(-R, R + 1):
            acc += tmp[min(S - 1, max(0, y)) * S + x]
        for y in range(S):
            det[y * S + x] = lum[y * S + x] - acc / (2 * R + 1)
            acc += tmp[min(S - 1, y + R + 1) * S + x] - tmp[max(0, y - R) * S + x]

    mx = max(abs(v) for v in det) or 1.0
    det = [v / mx for v in det]
    print('细节幅度归一化：max|d| = %.2f' % mx)

    # 3) 法线图（中心差分）+ 边缘按环绕取，保证可平铺
    AMP = 2.6
    nrm = bytearray(S * S * 3)
    for y in range(S):
        for x in range(S):
            dx = (det[y * S + (x - 1) % S] - det[y * S + (x + 1) % S]) * AMP
            dy = (det[((y - 1) % S) * S + x] - det[((y + 1) % S) * S + x]) * AMP
            ln = (dx * dx + dy * dy + 1) ** 0.5
            i = (y * S + x) * 3
            nrm[i] = int((dx / ln * 0.5 + 0.5) * 255)
            nrm[i + 1] = int((dy / ln * 0.5 + 0.5) * 255)
            nrm[i + 2] = int((1 / ln * 0.5 + 0.5) * 255)

    # 4) 粗糙度：围绕 1.0 做 ±12% 的微调（乘在材质 roughness 上）
    rgh = bytearray(S * S)
    for i in range(S * S):
        rgh[i] = max(0, min(255, int(246 + det[i] * 26)))

    n1 = write_png(out_prefix + '_normal.png', S, S, 3, nrm)
    n2 = write_png(out_prefix + '_rough.png', S, S, 1, rgh)
    print('normal %d B, rough %d B' % (n1, n2))
    for p in (out_prefix + '_normal.png', out_prefix + '_rough.png'):
        b = base64.b64encode(open(p, 'rb').read()).decode()
        open(p + '.b64', 'w').write(b)
        print(p, 'base64', len(b))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6]))
