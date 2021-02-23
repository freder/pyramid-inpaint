// adapted from: https://github.com/golanlevin/image_inpainting_processing/blob/master/pyramid_inpainting/pyramid_inpainting.pde

const maskAlpha = 0;


function indexFromXY(x: number, y: number, width: number) {
	return y * (width * 4) + (x * 4);
}


function rgbaAtIndex(imgData: ImageData, idx: number): Array<number> {
	const r = imgData.data[idx + 0];
	const g = imgData.data[idx + 1];
	const b = imgData.data[idx + 2];
	const a = imgData.data[idx + 3];
	return [r, g, b, a];
}


function rgbaAtXY(imgData: ImageData, x: number, y: number): Array<number> {
	const { width } = imgData;
	const idx = indexFromXY(x, y, width);
	return rgbaAtIndex(imgData, idx);
}


function setRgbaAtIndex(
	dst: ImageData,
	dstIndex: number,
	dstColor: Array<number>
): void {
	dst.data[dstIndex + 0] = dstColor[0];
	dst.data[dstIndex + 1] = dstColor[1];
	dst.data[dstIndex + 2] = dstColor[2];
	dst.data[dstIndex + 3] = dstColor[3];
}


function lerp2(s: number, e: number, t: number): number {
	return s + (e - s) * t;
}

function blerp(
	c00: number,
	c10: number,
	c01: number,
	c11: number,
	tx: number,
	ty: number
): number {
	return lerp2(
		lerp2(c00, c10, tx),
		lerp2(c01, c11, tx),
		ty
	);
}


function inpaint(
	ctx: CanvasRenderingContext2D,
	outCtx: CanvasRenderingContext2D,
	nLevels: number = 9
): void {
	const { width, height } = ctx.canvas;
	const inputImage = ctx.getImageData(0, 0, width, height);

	let mipmap: Array<ImageData> = new Array(nLevels);
	let upscaled: Array<ImageData> = new Array(nLevels);

	for (let i = 0; i < nLevels; i++) {
		const twopow = Math.pow(2, i);
		mipmap[i] = ctx.createImageData(
			Math.ceil(width / twopow),
			Math.ceil(height / twopow)
		);
	}

	for (let i = 1; i < nLevels; i++) { // Caution: no 0th element.
		const twopowm1 = Math.pow(2, i - 1);
		upscaled[i] = ctx.createImageData(
			Math.ceil(width / twopowm1),
			Math.ceil(height / twopowm1)
		);
	}

	//-------------------
	// Copy the first level, at the original scale.
	let srcW = inputImage.width;
	let srcH = inputImage.height;
	let dstW = mipmap[0].width;
	let dstH = mipmap[0].height;

	mipmap[0].data.set(inputImage.data);

	//-------------------
	// Analysis: generate the subsequent mipmap levels
	for (let level = 1; level < nLevels; level++) {
	  	const srcMipmap = mipmap[level - 1];
	  	const dstMipmap = mipmap[level];

		srcW = srcMipmap.width;
		srcH = srcMipmap.height;
		dstW = dstMipmap.width;
		dstH = dstMipmap.height;

		for (let dstX = 0; dstX < dstW; dstX++) {
			for (let dstY = 0; dstY < dstH; dstY++) {
				// 4 neighboring pixel coords
				const srcX0 = dstX * 2;
				const srcY0 = dstY * 2;
				const srcX1 = dstX * 2 + 1;
				const srcY1 = dstY * 2;
				const srcX2 = dstX * 2;
				const srcY2 = dstY * 2 + 1;
				const srcX3 = dstX * 2 + 1;
				const srcY3 = dstY * 2 + 1;

				const srcColor0 = rgbaAtXY(srcMipmap, srcX0, srcY0);
				const srcColor1 = rgbaAtXY(srcMipmap, srcX1, srcY1);
				const srcColor2 = rgbaAtXY(srcMipmap, srcX2, srcY2);
				const srcColor3 = rgbaAtXY(srcMipmap, srcX3, srcY3);

				let count = 0;
				let r = 0;
				let b = 0;
				let g = 0;
				if (srcColor0[3] != maskAlpha) {
					r += srcColor0[0];
					g += srcColor0[1];
					b += srcColor0[2];
					count++;
				}
				if (srcColor1[3] != maskAlpha) {
					r += srcColor1[0];
					g += srcColor1[1];
					b += srcColor1[2];
					count++;
				}
				if (srcColor2[3] != maskAlpha) {
					r += srcColor2[0];
					g += srcColor2[1];
					b += srcColor2[2];
					count++;
				}
				if (srcColor3[3] != maskAlpha) {
					r += srcColor3[0];
					g += srcColor3[1];
					b += srcColor3[2];
					count++;
				}

				let dstColor = [0, 0, 0, maskAlpha];
				if (count > 0) {
					dstColor = [
						Math.floor(r / count),
						Math.floor(g / count),
						Math.floor(b / count),
						255
					];
				}

				const dstIndex = indexFromXY(dstX, dstY, dstW);
				setRgbaAtIndex(dstMipmap, dstIndex, dstColor);
			}
		}
	}

	//-------------------
	// Synthesis: Propagate the filled data down the pyramid.
	for (let level = nLevels - 2; level >= 0; level--) {
		// the one to fill
		const filMipmap = mipmap[level];
		// the next higher mipmap
		const srcMipmap = mipmap[level + 1];
		// the one to fill from: the next higher mipmap, upscaled
		const dstMipmap = upscaled[level + 1];

		const filW = filMipmap.width;
		const filH = filMipmap.height;
		srcW = srcMipmap.width;
		srcH = srcMipmap.height;
		dstW = dstMipmap.width;
		dstH = dstMipmap.height;

		for (let filY = 0; filY < filH; filY++) {
			for (let filX = 0; filX < filW; filX++) {
				const filIndex = indexFromXY(filX, filY, filW);

				// check if there are any mask pixels in the one to fill
				if (filMipmap.data[filIndex + 3] == maskAlpha) {
					// upscaled image, and image-to-fill, have the same dimensions
					const dstX = filX;
					const dstY = filY;

					const gx = dstX / 2.0;
					const gy = dstY / 2.0;
					let gxi = Math.floor(gx);
					let gyi = Math.floor(gy);
					gxi = Math.min(gxi, srcW - 2);
					gyi = Math.min(gyi, srcH - 2);

					const c00 = rgbaAtXY(srcMipmap, gxi    , gyi    );
					const c10 = rgbaAtXY(srcMipmap, gxi + 1, gyi    );
					const c01 = rgbaAtXY(srcMipmap, gxi    , gyi + 1);
					const c11 = rgbaAtXY(srcMipmap, gxi + 1, gyi + 1);

					const dstColor = [255, 255, 255, 255];
					for (let ch = 0; ch < 3; ++ch) {
						const b00 = c00[ch];
						const b10 = c10[ch];
						const b01 = c01[ch];
						const b11 = c11[ch];
						dstColor[ch] = blerp(b00, b10, b01, b11, gx - gxi, gy - gyi);
					}

					setRgbaAtIndex(dstMipmap, filIndex, dstColor);
					setRgbaAtIndex(filMipmap, filIndex, rgbaAtIndex(dstMipmap, filIndex));
				}
			}
		}
	}

	//-------------------
	// Draw the results
	let mipY = inputImage.height;
	outCtx.putImageData(inputImage, 0, 0);
	outCtx.putImageData(mipmap[0], 0, mipY);
	const mipX = mipmap[0].width;
	for (let i = 1; i < nLevels; i++) {
		outCtx.putImageData(mipmap[i], mipX, mipY);
		mipY += mipmap[i].height;
	}
}
