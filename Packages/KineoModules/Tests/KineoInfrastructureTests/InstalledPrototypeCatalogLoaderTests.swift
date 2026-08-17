import KineoCore
import KineoInfrastructure
import Testing

@Suite("Installed prototype catalog")
struct InstalledPrototypeCatalogLoaderTests {
    @Test("Bundled prototype asset bytes and catalog validate together")
    func loadsInstalledCatalog() throws {
        let installed = try InstalledPrototypeCatalogLoader.load()

        #expect(installed.catalog.buildEligibility == [.internalPrototype])
        #expect(installed.resources.assetDigestsByPath.isEmpty == false)
        try CatalogValidator.validate(
            installed.catalog,
            for: .internalPrototype,
            resources: installed.resources
        )
    }
}
