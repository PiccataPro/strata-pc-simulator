import { Color } from 'three';
import { Pass } from './Pass.js';

class MaskPass extends Pass {

	constructor( scene, camera ) {

		super();

		this.scene = scene;
		this.camera = camera;

		this.clear = true;
		this.needsSwap = false;

		this.inverse = false;

	}

	render( renderer, writeBuffer, readBuffer /*, deltaTime, maskActive */ ) {

		const context = renderer.getContext();
		const state = renderer.state;

		// don't update color buffer

		state.buffers.color.setMask( false, 0, 0, 0, 0 );

		// don't clear the depth buffer

		state.buffers.depth.setTest( false );

		// render only original scene

		state.buffers.stencil.setTest( true );
		state.buffers.stencil.setOp( context.REPLACE, context.REPLACE, context.REPLACE );
		state.buffers.stencil.setFunc( context.ALWAYS, 1, 0xffffffff );
		state.buffers.stencil.setClear( 0 );

		renderer.setRenderTarget( readBuffer );
		if ( this.clear ) renderer.clear();
		renderer.render( this.scene, this.camera );

		renderer.setRenderTarget( writeBuffer );
		if ( this.clear ) renderer.clear();
		renderer.render( this.scene, this.camera );

		// restore color buffer

		state.buffers.color.setMask( true, true, true, true );
		state.buffers.depth.setTest( true );

		// set fullscreen quad pass to null

	}

}

class ClearMaskPass extends Pass {

	constructor() {

		super();

		this.needsSwap = false;

	}

	render( renderer /*, writeBuffer, readBuffer, deltaTime, maskActive */ ) {

		renderer.state.buffers.stencil.setTest( false );

	}

}

export { MaskPass, ClearMaskPass };
