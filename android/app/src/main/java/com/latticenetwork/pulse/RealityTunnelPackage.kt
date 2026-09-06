package com.latticenetwork.pulse

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class RealityTunnelPackage : ReactPackage {
  override fun createNativeModules(ctx: ReactApplicationContext): MutableList<NativeModule> =
    mutableListOf(RealityTunnelModule(ctx), MeshControlModule(ctx), CallControlModule(ctx), DeviceInfoModule(ctx), KdfModule(ctx), HwKeyModule(ctx), IntegrityModule(ctx))

  override fun createViewManagers(ctx: ReactApplicationContext): MutableList<ViewManager<*, *>> =
    mutableListOf()
}
