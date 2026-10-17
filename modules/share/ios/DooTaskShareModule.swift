import ExpoModulesCore

public class DooTaskShareModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DooTaskShare")

    Function("writeSettings") { (settings: [String: String]) throws in
      try ShareStorage.write(settings)
    }
  }
}
